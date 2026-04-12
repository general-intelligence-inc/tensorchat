import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../context/ThemeContext";
import { type ColorPalette, FONT, RADII, SPACING } from "../constants/theme";
import { MiniAppWebView } from "./MiniAppWebView";
import { readApp } from "./storage";
import type { MiniApp, RuntimeError } from "./types";

interface MiniAppFullscreenProps {
  appId: string;
  onClose: () => void;
  onDelete?: (appId: string) => Promise<void> | void;
  onOpenChat?: (chatId: string) => void;
  onRuntimeError?: (
    appId: string,
    version: number,
    error: RuntimeError,
  ) => void;
}

/**
 * Fullscreen viewer for a mini-app. Same sandbox as the inline card, just
 * given the whole screen. Intended to be rendered inside a React Native
 * <Modal> from ChatScreen, following the FileVaultScreen pattern.
 */
export function MiniAppFullscreen({
  appId,
  onClose,
  onDelete,
  onOpenChat,
  onRuntimeError,
}: MiniAppFullscreenProps): React.JSX.Element {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [app, setApp] = useState<MiniApp | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    setApp(null);
    (async () => {
      try {
        const loaded = await readApp(appId);
        if (cancelled) return;
        if (!loaded) {
          setLoadError("This mini app could not be found.");
          return;
        }
        setApp(loaded);
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setLoadError("Failed to load app: " + msg);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [appId, reloadKey]);

  const handleReload = useCallback(() => {
    setReloadKey((k) => k + 1);
  }, []);

  const handleDelete = useCallback(() => {
    if (!app || !onDelete) return;
    Alert.alert(
      `Delete "${app.name}"?`,
      "This removes the mini app and its data. The owning chat is not deleted.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await onDelete(app.id);
              onClose();
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              Alert.alert("Delete failed", msg);
            }
          },
        },
      ],
    );
  }, [app, onDelete, onClose]);

  const handleOpenChat = useCallback(() => {
    if (!app || !onOpenChat) return;
    onOpenChat(app.chatId);
    onClose();
  }, [app, onOpenChat, onClose]);

  const handleRuntimeError = useCallback(
    (err: RuntimeError) => {
      if (!app) return;
      onRuntimeError?.(app.id, app.version, err);
    },
    [app, onRuntimeError],
  );

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom", "left", "right"]}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={onClose}
          style={styles.iconButton}
          activeOpacity={0.7}
          hitSlop={10}
        >
          <Ionicons name="close" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.titleWrap}>
          <Text style={styles.titleEmoji}>{app?.emoji ?? "📦"}</Text>
          <View style={styles.titleColumn}>
            <Text style={styles.title} numberOfLines={1}>
              {app?.name ?? "Loading…"}
            </Text>
            <Text style={styles.subtitle}>
              {app ? `v${app.version}` : ""}
            </Text>
          </View>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity
            onPress={handleReload}
            style={styles.iconButton}
            activeOpacity={0.7}
            hitSlop={10}
          >
            <Ionicons
              name="refresh-outline"
              size={22}
              color={colors.textSecondary}
            />
          </TouchableOpacity>
          {onOpenChat ? (
            <TouchableOpacity
              onPress={handleOpenChat}
              style={styles.iconButton}
              activeOpacity={0.7}
              hitSlop={10}
            >
              <Ionicons
                name="chatbubble-ellipses-outline"
                size={22}
                color={colors.textSecondary}
              />
            </TouchableOpacity>
          ) : null}
          {onDelete ? (
            <TouchableOpacity
              onPress={handleDelete}
              style={styles.iconButton}
              activeOpacity={0.7}
              hitSlop={10}
            >
              <Ionicons
                name="trash-outline"
                size={22}
                color={colors.destructive}
              />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      <View style={styles.body}>
        {loadError ? (
          <View style={styles.errorWrap}>
            <Ionicons
              name="alert-circle-outline"
              size={32}
              color={colors.errorText}
            />
            <Text style={styles.errorText}>{loadError}</Text>
          </View>
        ) : app ? (
          <MiniAppWebView
            key={`${app.id}-v${app.version}-r${reloadKey}`}
            appId={app.id}
            version={app.version}
            style={styles.webView}
            onRuntimeError={handleRuntimeError}
          />
        ) : (
          <View style={styles.loadingWrap}>
            <Text style={styles.loadingText}>Loading…</Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.base,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      gap: SPACING.sm,
    },
    iconButton: {
      padding: SPACING.xs,
      borderRadius: RADII.sm,
    },
    titleWrap: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: SPACING.sm,
      minWidth: 0,
    },
    titleEmoji: {
      fontSize: 22,
    },
    titleColumn: {
      flex: 1,
      minWidth: 0,
    },
    title: {
      fontSize: 15,
      fontWeight: FONT.semibold,
      color: colors.textPrimary,
    },
    subtitle: {
      fontSize: 11,
      color: colors.textTertiary,
      marginTop: 1,
    },
    headerActions: {
      flexDirection: "row",
      alignItems: "center",
      gap: SPACING.xs,
    },
    body: {
      flex: 1,
      backgroundColor: colors.base,
    },
    webView: {
      flex: 1,
      backgroundColor: "transparent",
    },
    loadingWrap: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    loadingText: {
      fontSize: 13,
      color: colors.textSecondary,
    },
    errorWrap: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: SPACING.xl,
      gap: SPACING.md,
    },
    errorText: {
      fontSize: 13,
      color: colors.errorText,
      textAlign: "center",
    },
  });
}
