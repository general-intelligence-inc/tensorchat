import React, { useCallback, useMemo, useRef } from "react";
import { Platform, View, StyleSheet, Text } from "react-native";
import { optionalRequire } from "../utils/optionalRequire";
import { getAppFileUri, MINIAPPS_DIR } from "./storage";
import type { RuntimeError } from "./types";

// Dynamic require per CLAUDE.md non-negotiable #4: keep this module evaluable
// in web / non-native environments even if react-native-webview isn't present.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let WebViewComponent: any = null;
const webViewModule = optionalRequire<{ WebView: unknown; default?: unknown }>(
  () => require("react-native-webview"),
);
if (webViewModule) {
  WebViewComponent = webViewModule.WebView ?? webViewModule.default ?? null;
}

export interface MiniAppWebViewProps {
  appId: string;
  /**
   * Version from the owning MiniApp. Changing this forces a full remount of
   * the WebView (via React `key`), giving the new code a clean DOM and JS
   * context. localStorage survives because it's keyed by the file-path origin.
   */
  version: number;
  style?: object;
  onRuntimeError?: (error: RuntimeError) => void;
  onLoadError?: (message: string) => void;
}

interface IncomingMessage {
  type?: string;
  message?: string;
  source?: string;
  line?: number;
  col?: number;
  stack?: string;
}

/**
 * Sandboxed WebView that renders a mini-app from disk.
 *
 * Security posture (layered defense):
 *   - CSP meta tag inside the generated index.html blocks network egress, form
 *     submissions, plugins, base-tag tricks, and worker spawning
 *   - A JS shim (also baked into index.html) neutralizes fetch/XHR/WS/etc.
 *   - `originWhitelist={["file://*"]}` prevents loading anything that isn't
 *     a local file URL
 *   - `onShouldStartLoadWithRequest` refuses navigation to any URL outside
 *     this app's directory (stops location.href = "file://.../otherApp/")
 *   - `setSupportMultipleWindows={false}` blocks window.open
 *   - `allowFileAccessFromFileURLs={false}` plus
 *     `allowUniversalAccessFromFileURLs={false}` prevent reading sibling files
 *
 * Each app lives in its own directory, so each one gets its own file-path
 * origin — localStorage is namespaced automatically.
 */
export function MiniAppWebView(props: MiniAppWebViewProps): React.ReactElement {
  const { appId, version, style, onRuntimeError, onLoadError } = props;
  const appDirPrefix = useRef(`file://${MINIAPPS_DIR}/${appId}/`).current;
  const fileUri = useMemo(() => getAppFileUri(appId), [appId]);

  const handleMessage = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (event: any) => {
      try {
        const raw: string | undefined = event?.nativeEvent?.data;
        if (!raw) return;
        const parsed: IncomingMessage = JSON.parse(raw);
        if (parsed.type === "js-error") {
          onRuntimeError?.({
            message: parsed.message ?? "Unknown error",
            source: parsed.source,
            line: parsed.line,
            col: parsed.col,
            stack: parsed.stack,
          });
        }
      } catch {
        // Ignore malformed messages — the shim controls its own payloads.
      }
    },
    [onRuntimeError],
  );

  const handleShouldStartLoadWithRequest = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (request: any): boolean => {
      const url: string | undefined = request?.url;
      if (!url) return false;
      // about:blank is used internally by some WebView implementations during
      // navigation setup.
      if (url === "about:blank") return true;
      return url.startsWith(appDirPrefix);
    },
    [appDirPrefix],
  );

  const handleError = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (event: any) => {
      const description: string =
        event?.nativeEvent?.description ?? "WebView failed to load";
      onLoadError?.(description);
    },
    [onLoadError],
  );

  if (!WebViewComponent) {
    // Web / non-native fallback. The feature only runs on real devices.
    return (
      <View style={[styles.fallback, style]}>
        <Text style={styles.fallbackText}>
          Mini apps require a native build (iOS / Android).
        </Text>
      </View>
    );
  }

  return (
    <WebViewComponent
      key={`${appId}-v${version}`}
      source={{ uri: fileUri }}
      style={style}
      // Security posture
      originWhitelist={["file://*"]}
      javaScriptEnabled
      domStorageEnabled
      thirdPartyCookiesEnabled={false}
      sharedCookiesEnabled={false}
      cacheEnabled={false}
      incognito={false}
      allowFileAccess
      allowFileAccessFromFileURLs={false}
      allowUniversalAccessFromFileURLs={false}
      allowsLinkPreview={false}
      mixedContentMode="never"
      mediaPlaybackRequiresUserAction
      setSupportMultipleWindows={false}
      javaScriptCanOpenWindowsAutomatically={false}
      // Navigation interception
      onShouldStartLoadWithRequest={handleShouldStartLoadWithRequest}
      onMessage={handleMessage}
      onError={handleError}
      onHttpError={handleError}
      // Display
      scrollEnabled
      bounces={false}
      overScrollMode="never"
      automaticallyAdjustContentInsets={false}
      {...(Platform.OS === "android"
        ? { androidLayerType: "hardware" as const }
        : {})}
    />
  );
}

const styles = StyleSheet.create({
  fallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  fallbackText: {
    fontSize: 13,
    color: "#888",
    textAlign: "center",
  },
});
