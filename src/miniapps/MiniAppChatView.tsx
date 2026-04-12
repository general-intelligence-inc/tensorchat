import React, { useMemo } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../context/ThemeContext";
import { type ColorPalette, FONT, RADII, SPACING } from "../constants/theme";
import { MiniAppWebView } from "./MiniAppWebView";
import type { MiniAppIndexEntry, RuntimeError } from "./types";

/**
 * Artifact-first view for a Mini Apps chat.
 *
 * This is NOT a chat transcript. It renders the LIVE running mini-app as
 * the primary surface, with a transient status strip overlaid at the top
 * for generation / retry / error states. No message bubbles, no scrolling
 * history — the app IS the output.
 *
 * Generation progress lives in a separate status state held by ChatScreen
 * (not in `Message.isStreaming`), so there's no assistant placeholder
 * cluttering the view.
 */

export type MiniAppGenStatus =
  | { kind: "idle" }
  | { kind: "planning"; label?: string }
  | { kind: "generating"; label?: string }
  | { kind: "retrying"; label?: string }
  | { kind: "writing"; label?: string }
  | { kind: "error"; message: string };

interface MiniAppChatViewProps {
  topInset: number;
  /** The current app's index entry, or null if the chat hasn't built anything yet. */
  entry: MiniAppIndexEntry | null;
  status: MiniAppGenStatus;
  onOpenFullscreen: (appId: string) => void;
  onRuntimeError: (
    appId: string,
    version: number,
    error: RuntimeError,
  ) => void;
  onRetry?: () => void;
  /**
   * Cancel an in-flight build/retry. Rendered as a small Stop button in
   * the status strip when status is generating or retrying. Without this,
   * a stuck run has no user-facing escape hatch.
   */
  onCancel?: () => void;
  /**
   * Roll back to the previous version in the app's history. Rendered as
   * an inline button in the app-meta row when the current entry has at
   * least one snapshot in history/ (`historyDepth > 0`) AND status is
   * idle — we never let the user undo while a new version is being
   * written.
   */
  onUndo?: () => void;
  /**
   * Optional slot for dev-only overlays (e.g. the trace panel).
   * Rendered absolutely positioned on top of the chat view. ChatScreen
   * wires this up only in __DEV__ builds, so production users never see
   * the debug affordances.
   */
  devOverlay?: React.ReactNode;
}

// Approx height of the floating ChatHeader above the content area.
const CHAT_HEADER_OFFSET = 56;

export function MiniAppChatView({
  topInset,
  entry,
  status,
  onOpenFullscreen,
  onRuntimeError,
  onRetry,
  onCancel,
  onUndo,
  devOverlay,
}: MiniAppChatViewProps): React.JSX.Element {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const handleRuntimeError = React.useCallback(
    (err: RuntimeError) => {
      if (!entry) return;
      onRuntimeError(entry.id, entry.version, err);
    },
    [entry, onRuntimeError],
  );

  const isBusy =
    status.kind === "planning" ||
    status.kind === "generating" ||
    status.kind === "retrying" ||
    status.kind === "writing";

  const canUndo =
    !!entry &&
    (entry.historyDepth ?? 0) > 0 &&
    status.kind === "idle" &&
    !!onUndo;

  return (
    <View style={[styles.root, { paddingTop: topInset + CHAT_HEADER_OFFSET }]}>
      {/* Status strip — overlays the top of the content area when non-idle. */}
      {status.kind !== "idle" ? (
        <View
          style={[
            styles.statusStrip,
            status.kind === "error" && styles.statusStripError,
          ]}
        >
          {isBusy ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ) : (
            <Ionicons
              name="alert-circle-outline"
              size={16}
              color={colors.errorText}
            />
          )}
          <Text
            style={[
              styles.statusText,
              status.kind === "error" && styles.statusTextError,
            ]}
            numberOfLines={2}
          >
            {status.kind === "planning"
              ? (status.label ?? "Planning…")
              : status.kind === "generating"
                ? (status.label ?? "Building app…")
                : status.kind === "retrying"
                  ? (status.label ?? "Refining app…")
                  : status.kind === "writing"
                    ? (status.label ?? "Writing…")
                    : status.message}
          </Text>
          {status.kind === "error" && onRetry ? (
            <TouchableOpacity
              onPress={onRetry}
              style={styles.retryButton}
              activeOpacity={0.7}
            >
              <Text style={styles.retryButtonText}>Retry</Text>
            </TouchableOpacity>
          ) : null}
          {isBusy && onCancel ? (
            <TouchableOpacity
              onPress={onCancel}
              style={styles.retryButton}
              activeOpacity={0.7}
            >
              <Text style={styles.retryButtonText}>Stop</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {entry ? (
        // App exists — render the live WebView as the primary surface.
        <View style={styles.webViewFrame}>
          <View style={styles.appMetaRow}>
            <Text style={styles.appMetaEmoji}>{entry.emoji}</Text>
            <Text style={styles.appMetaName} numberOfLines={1}>
              {entry.name}
            </Text>
            <Text style={styles.appMetaVersion}>v{entry.version}</Text>
            <View style={{ flex: 1 }} />
            {canUndo ? (
              <TouchableOpacity
                onPress={onUndo}
                style={styles.metaIconButton}
                activeOpacity={0.7}
                hitSlop={8}
              >
                <Ionicons
                  name="arrow-undo-outline"
                  size={18}
                  color={colors.textSecondary}
                />
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              onPress={() => onOpenFullscreen(entry.id)}
              style={styles.metaIconButton}
              activeOpacity={0.7}
              hitSlop={8}
            >
              <Ionicons
                name="expand-outline"
                size={18}
                color={colors.textSecondary}
              />
            </TouchableOpacity>
          </View>
          <MiniAppWebView
            appId={entry.id}
            version={entry.version}
            style={styles.webView}
            onRuntimeError={handleRuntimeError}
          />
        </View>
      ) : isBusy ? (
        // First build in progress — show a compact building placeholder.
        <View style={styles.placeholder}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={styles.placeholderTitle}>Building your app…</Text>
          <Text style={styles.placeholderBody}>
            This only takes a few seconds on-device.
          </Text>
        </View>
      ) : (
        // No app yet — show a prompt hint inviting the first description.
        <View style={styles.placeholder}>
          <Text style={styles.placeholderTitle}>Describe a mini-app</Text>
          <Text style={styles.placeholderBody}>
            Tell the model what you want — a calculator, a stopwatch, a todo
            list, a guessing game. It builds everything on-device.
          </Text>
          <View style={styles.suggestionColumn}>
            <Text style={styles.suggestionItem}>“build me a pomodoro timer”</Text>
            <Text style={styles.suggestionItem}>“a simple tip calculator”</Text>
            <Text style={styles.suggestionItem}>“coin flip with history”</Text>
          </View>
        </View>
      )}

      {/* Dev-only overlay slot (e.g. trace panel). Absolute-positioned
          over the chat view so it never affects layout. */}
      {devOverlay}
    </View>
  );
}

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.base,
    },
    statusStrip: {
      marginHorizontal: SPACING.lg,
      marginTop: SPACING.sm,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      borderRadius: RADII.md,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      flexDirection: "row",
      alignItems: "center",
      gap: SPACING.sm,
    },
    statusStripError: {
      borderColor: colors.errorBarBorder,
      backgroundColor: colors.errorBarBg,
    },
    statusText: {
      flex: 1,
      fontSize: 12,
      color: colors.textSecondary,
      lineHeight: 16,
    },
    statusTextError: {
      color: colors.errorText,
    },
    retryButton: {
      paddingHorizontal: SPACING.sm,
      paddingVertical: 4,
      borderRadius: RADII.sm,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    retryButtonText: {
      fontSize: 12,
      fontWeight: FONT.semibold,
      color: colors.textPrimary,
    },
    webViewFrame: {
      flex: 1,
      marginHorizontal: SPACING.lg,
      marginTop: SPACING.md,
      marginBottom: SPACING.md,
      borderRadius: RADII.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      overflow: "hidden",
      backgroundColor: colors.surface,
    },
    appMetaRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      gap: SPACING.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.borderSubtle,
    },
    appMetaEmoji: {
      fontSize: 20,
    },
    appMetaName: {
      fontSize: 13,
      fontWeight: FONT.semibold,
      color: colors.textPrimary,
      flexShrink: 1,
    },
    appMetaVersion: {
      fontSize: 10,
      color: colors.textTertiary,
      marginLeft: 2,
    },
    metaIconButton: {
      padding: SPACING.xs,
      borderRadius: RADII.sm,
    },
    webView: {
      flex: 1,
      backgroundColor: "transparent",
    },
    placeholder: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: SPACING.xl,
      gap: SPACING.md,
    },
    placeholderTitle: {
      fontSize: 17,
      fontWeight: FONT.semibold,
      color: colors.textPrimary,
      textAlign: "center",
    },
    placeholderBody: {
      fontSize: 13,
      color: colors.textSecondary,
      textAlign: "center",
      lineHeight: 18,
      maxWidth: 300,
    },
    suggestionColumn: {
      marginTop: SPACING.md,
      gap: 6,
      alignItems: "center",
    },
    suggestionItem: {
      fontSize: 12,
      color: colors.textTertiary,
      fontStyle: "italic",
    },
  });
}
