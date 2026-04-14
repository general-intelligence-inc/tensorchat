import React, { useCallback, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type ListRenderItemInfo,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../context/ThemeContext";
import { type ColorPalette, FONT, RADII, SPACING } from "../constants/theme";
import type { MiniAppIndexEntry } from "./types";
import { isValidEmoji, isValidName, MAX_APP_NAME_CHARS } from "./identity";

export interface MiniAppHomeProps {
  entries: MiniAppIndexEntry[];
  /** Top safe-area inset — used so the header clears the floating ChatHeader. */
  topInset: number;
  /**
   * Model status for the miniapp slot. Controls which banner the grid header
   * shows and whether the "+ New" button is enabled.
   */
  modelStatus: MiniAppModelStatus;
  /** Tap: open the owning chat for iteration. */
  onOpenChat: (chatId: string) => void;
  /** Long-press "Open fullscreen" action. */
  onOpenFullscreen: (appId: string) => void;
  /** Long-press "Delete app & chat" action. */
  onDeleteApp: (appId: string, alsoChat: boolean) => Promise<void> | void;
  /**
   * Long-press "Rename" action. Provides a name + emoji patch and ChatScreen
   * persists it via the storage layer's `renameApp`. Throws to surface an
   * error to the user.
   */
  onRenameApp: (
    appId: string,
    patch: { name: string; emoji: string },
  ) => Promise<void> | void;
  /** Tap the header "+ New" button. */
  onNewChat: () => void;
  /** Tap the "Download Gemma 4 E2B" CTA in the status banner. */
  onDownloadModel: () => void;
}

export type MiniAppModelStatus =
  | { kind: "ready"; modelName: string }
  | { kind: "loading" }
  | { kind: "missing" };

// Approx height of the main app's floating ChatHeader above the content.
const CHAT_HEADER_OFFSET = 56;

/**
 * Landing page for Mini Apps mode. Shows all user-created mini-apps as
 * a grid of emoji tiles on a "home screen". Tapping a tile opens the owning
 * chat so the user can iterate; long-pressing offers the fullscreen viewer
 * and delete.
 */
export function MiniAppHome({
  entries,
  topInset,
  modelStatus,
  onOpenChat,
  onOpenFullscreen,
  onDeleteApp,
  onRenameApp,
  onNewChat,
  onDownloadModel,
}: MiniAppHomeProps): React.JSX.Element {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  // Newest first so the most recent work is top-left.
  const sortedEntries = useMemo(
    () => [...entries].sort((a, b) => b.updatedAt - a.updatedAt),
    [entries],
  );

  const isReady = modelStatus.kind === "ready";
  const newDisabled = !isReady;

  // Rename modal state — driven by the long-press action sheet "Rename"
  // entry. When `renameTarget` is non-null the modal is visible. The
  // draft name/emoji are local to the modal so the user can edit without
  // mutating the index entry until they hit Save.
  const [renameTarget, setRenameTarget] = useState<MiniAppIndexEntry | null>(
    null,
  );
  const [renameNameDraft, setRenameNameDraft] = useState("");
  const [renameEmojiDraft, setRenameEmojiDraft] = useState("");
  const [renameSaving, setRenameSaving] = useState(false);

  const openRenameDialog = useCallback((entry: MiniAppIndexEntry) => {
    setRenameTarget(entry);
    setRenameNameDraft(entry.name);
    setRenameEmojiDraft(entry.emoji);
    setRenameSaving(false);
  }, []);

  const closeRenameDialog = useCallback(() => {
    setRenameTarget(null);
    setRenameNameDraft("");
    setRenameEmojiDraft("");
    setRenameSaving(false);
  }, []);

  const renameValid =
    isValidName(renameNameDraft) && isValidEmoji(renameEmojiDraft);

  const handleRenameSubmit = useCallback(async () => {
    if (!renameTarget || !renameValid || renameSaving) return;
    setRenameSaving(true);
    try {
      await onRenameApp(renameTarget.id, {
        name: renameNameDraft.trim(),
        emoji: renameEmojiDraft.trim(),
      });
      closeRenameDialog();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      Alert.alert("Rename failed", msg);
      setRenameSaving(false);
    }
  }, [
    renameTarget,
    renameValid,
    renameSaving,
    onRenameApp,
    renameNameDraft,
    renameEmojiDraft,
    closeRenameDialog,
  ]);

  // The grid renders a union of real apps + a trailing synthetic "+" tile.
  // Keeping the "new" affordance inside the grid matches a phone home-screen
  // better than a separate header pill: you scroll past your apps and the
  // next slot is the create-new icon.
  type GridItem =
    | { kind: "app"; entry: MiniAppIndexEntry }
    | { kind: "new" };

  const gridData = useMemo<GridItem[]>(
    () => [
      ...sortedEntries.map(
        (entry): GridItem => ({ kind: "app", entry }),
      ),
      { kind: "new" },
    ],
    [sortedEntries],
  );

  const handleLongPress = useCallback(
    (entry: MiniAppIndexEntry) => {
      Alert.alert(
        `${entry.emoji} ${entry.name}`,
        "What would you like to do?",
        [
          {
            text: "Open fullscreen",
            onPress: () => onOpenFullscreen(entry.id),
          },
          {
            text: "Open owning chat",
            onPress: () => onOpenChat(entry.chatId),
          },
          {
            text: "Rename",
            onPress: () => openRenameDialog(entry),
          },
          {
            text: "Delete app & chat",
            style: "destructive",
            onPress: () => {
              Alert.alert(
                `Delete "${entry.name}"?`,
                "This removes the mini app, its data, and the chat that built it. This cannot be undone.",
                [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Delete",
                    style: "destructive",
                    onPress: async () => {
                      try {
                        await onDeleteApp(entry.id, true);
                      } catch (err) {
                        const msg =
                          err instanceof Error ? err.message : String(err);
                        Alert.alert("Delete failed", msg);
                      }
                    },
                  },
                ],
              );
            },
          },
          { text: "Cancel", style: "cancel" },
        ],
      );
    },
    [onDeleteApp, onOpenChat, onOpenFullscreen, openRenameDialog],
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<GridItem>) => {
      if (item.kind === "new") {
        return (
          <TouchableOpacity
            style={styles.tile}
            activeOpacity={0.75}
            onPress={onNewChat}
            disabled={newDisabled}
          >
            <View
              style={[
                styles.tileIconBox,
                styles.tileIconBoxNew,
                newDisabled && styles.tileIconBoxDisabled,
              ]}
            >
              <Ionicons
                name="add"
                size={30}
                color={newDisabled ? colors.textTertiary : colors.accent}
              />
            </View>
            <Text
              style={[
                styles.tileName,
                newDisabled && styles.tileNameDisabled,
              ]}
              numberOfLines={1}
            >
              New
            </Text>
          </TouchableOpacity>
        );
      }

      const entry = item.entry;
      return (
        <TouchableOpacity
          style={styles.tile}
          activeOpacity={0.75}
          onPress={() => onOpenChat(entry.chatId)}
          onLongPress={() => handleLongPress(entry)}
          delayLongPress={350}
        >
          <View style={styles.tileIconBox}>
            <Text style={styles.tileEmoji}>{entry.emoji}</Text>
          </View>
          <Text style={styles.tileName} numberOfLines={1}>
            {entry.name}
          </Text>
        </TouchableOpacity>
      );
    },
    [colors, handleLongPress, newDisabled, onNewChat, onOpenChat, styles],
  );

  const keyExtractor = useCallback(
    (item: GridItem) => (item.kind === "new" ? "__new__" : item.entry.id),
    [],
  );

  const ListHeader = (
    <View style={[styles.headerWrap, { paddingTop: topInset + CHAT_HEADER_OFFSET + SPACING.md }]}>
      {/* Status banner — only shown when NOT ready. The "New" affordance
          now lives inside the grid as its own icon, not as a header pill. */}
      {modelStatus.kind === "loading" ? (
        <View style={styles.bannerLoading}>
          <Ionicons name="cloud-download-outline" size={16} color={colors.textSecondary} />
          <Text style={styles.bannerText}>
            Loading model — the New icon will be available shortly.
          </Text>
        </View>
      ) : null}

      {modelStatus.kind === "missing" ? (
        <TouchableOpacity
          onPress={onDownloadModel}
          style={styles.bannerMissing}
          activeOpacity={0.8}
        >
          <Ionicons name="download-outline" size={16} color={colors.accent} />
          <View style={styles.bannerTextColumn}>
            <Text style={styles.bannerTextBold}>Download a mini app model</Text>
            <Text style={styles.bannerText}>
              Download a supported model to start building. Tap to open the catalog.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
        </TouchableOpacity>
      ) : null}
    </View>
  );

  return (
    <>
      <FlatList
        style={styles.list}
        contentContainerStyle={styles.listContent}
        data={gridData}
        numColumns={4}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        ListHeaderComponent={ListHeader}
        columnWrapperStyle={styles.columnWrapper}
        showsVerticalScrollIndicator={false}
      />

      {/* Rename modal — driven by long-press → Rename action sheet entry. */}
      <Modal
        visible={renameTarget !== null}
        animationType="fade"
        transparent
        onRequestClose={closeRenameDialog}
      >
        <View style={styles.renameOverlay}>
          <View style={styles.renameCard}>
            <Text style={styles.renameTitle}>Rename app</Text>
            <Text style={styles.renameLabel}>Name</Text>
            <TextInput
              style={styles.renameInput}
              value={renameNameDraft}
              onChangeText={setRenameNameDraft}
              maxLength={MAX_APP_NAME_CHARS}
              placeholder="Mini App"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="words"
              autoCorrect={false}
              returnKeyType="next"
            />
            <Text style={styles.renameLabel}>Emoji</Text>
            <TextInput
              style={[styles.renameInput, styles.renameEmojiInput]}
              value={renameEmojiDraft}
              onChangeText={setRenameEmojiDraft}
              placeholder="✨"
              placeholderTextColor={colors.textTertiary}
              autoCorrect={false}
              maxLength={8}
              returnKeyType="done"
              onSubmitEditing={handleRenameSubmit}
            />
            <View style={styles.renameButtonRow}>
              <TouchableOpacity
                onPress={closeRenameDialog}
                style={styles.renameCancelButton}
                disabled={renameSaving}
              >
                <Text style={styles.renameCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleRenameSubmit}
                style={[
                  styles.renameSaveButton,
                  (!renameValid || renameSaving) && styles.renameSaveButtonDisabled,
                ]}
                disabled={!renameValid || renameSaving}
              >
                <Text style={styles.renameSaveText}>
                  {renameSaving ? "Saving…" : "Save"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    list: {
      flex: 1,
      backgroundColor: colors.base,
    },
    listContent: {
      paddingHorizontal: SPACING.lg,
      paddingBottom: SPACING.xxl,
    },
    headerWrap: {
      paddingBottom: SPACING.lg,
    },
    bannerLoading: {
      marginTop: SPACING.md,
      padding: SPACING.md,
      backgroundColor: colors.surface,
      borderRadius: RADII.md,
      flexDirection: "row",
      alignItems: "center",
      gap: SPACING.sm,
    },
    bannerMissing: {
      marginTop: SPACING.md,
      padding: SPACING.md,
      backgroundColor: colors.surface,
      borderRadius: RADII.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.accent,
      flexDirection: "row",
      alignItems: "center",
      gap: SPACING.sm,
    },
    bannerTextColumn: {
      flex: 1,
    },
    bannerText: {
      flex: 1,
      fontSize: 12,
      color: colors.textSecondary,
      lineHeight: 16,
    },
    bannerTextBold: {
      fontSize: 13,
      color: colors.textPrimary,
      fontWeight: FONT.semibold,
      marginBottom: 2,
    },
    columnWrapper: {
      justifyContent: "flex-start",
      marginBottom: SPACING.xl,
    },
    // Fixed-fraction width so a partial last row stays left-aligned
    // instead of stretching its tiles to fill the remaining space.
    tile: {
      width: "25%",
      alignItems: "center",
      gap: 6,
    },
    // Rounded square "icon" behind the emoji — sized like an iOS home-screen
    // app icon (~58pt). Subtle surface-tinted background; no border.
    tileIconBox: {
      width: 58,
      height: 58,
      borderRadius: 14,
      backgroundColor: colors.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    // "New" tile — outlined with the accent tint so it reads as an
    // affordance, not an existing app. No fill so it clearly contrasts
    // against the solid app tiles around it.
    tileIconBoxNew: {
      backgroundColor: "transparent",
      borderWidth: 1.5,
      borderColor: colors.accent,
      borderStyle: "dashed",
    },
    tileIconBoxDisabled: {
      borderColor: colors.borderSubtle,
    },
    tileEmoji: {
      fontSize: 32,
      lineHeight: 36,
      // Nudge the emoji down a hair so it optically centers inside the square.
      textAlignVertical: "center",
    },
    tileName: {
      fontSize: 10,
      color: colors.textPrimary,
      fontWeight: FONT.medium,
      textAlign: "center",
      maxWidth: 72,
    },
    tileNameDisabled: {
      color: colors.textTertiary,
    },
    // ── Rename modal ──────────────────────────────────────────────
    renameOverlay: {
      flex: 1,
      backgroundColor: colors.overlayBg,
      justifyContent: "center",
      alignItems: "center",
      paddingHorizontal: SPACING.xl,
    },
    renameCard: {
      width: "100%",
      maxWidth: 360,
      backgroundColor: colors.surface,
      borderRadius: RADII.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      padding: SPACING.lg,
      gap: SPACING.sm,
    },
    renameTitle: {
      fontSize: 17,
      fontWeight: FONT.semibold,
      color: colors.textPrimary,
      marginBottom: SPACING.xs,
    },
    renameLabel: {
      fontSize: 12,
      color: colors.textSecondary,
      marginTop: SPACING.xs,
    },
    renameInput: {
      backgroundColor: colors.base,
      borderRadius: RADII.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      fontSize: 15,
      color: colors.textPrimary,
    },
    renameEmojiInput: {
      fontSize: 20,
      textAlign: "center",
    },
    renameButtonRow: {
      flexDirection: "row",
      justifyContent: "flex-end",
      gap: SPACING.sm,
      marginTop: SPACING.md,
    },
    renameCancelButton: {
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      borderRadius: RADII.md,
    },
    renameCancelText: {
      fontSize: 14,
      color: colors.textSecondary,
      fontWeight: FONT.medium,
    },
    renameSaveButton: {
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      borderRadius: RADII.md,
      backgroundColor: colors.accent,
    },
    renameSaveButtonDisabled: {
      opacity: 0.4,
    },
    renameSaveText: {
      fontSize: 14,
      color: "#FFFFFF",
      fontWeight: FONT.semibold,
    },
  });
}
