import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Image,
  Linking,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  SectionList,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import * as FileSystem from "expo-file-system/legacy";
import { ColorPalette, FONT, RADII, SPACING } from "../constants/theme";
import { ThemePreference, useTheme } from "../context/ThemeContext";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";

const DEFAULT_SIDEBAR_WIDTH = 320;
const MODELS_DIR = (FileSystem.documentDirectory ?? "") + "models/";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export interface ChatSummary {
  id: string;
  title: string;
  createdAt: number;
  mode?: "chat" | "translation";
}

const THREAD_ACTIONS_WIDTH = 96;
const THREAD_ACTION_SIZE = 36;

interface SidebarProps {
  width?: number;
  visible: boolean;
  chats: ChatSummary[];
  activeChatId: string;
  onNewChat: () => void;
  onSelectChat: (id: string) => void;
  onDeleteChat: (id: string) => void;
  onRenameChat: (id: string) => void;
  onOpenTensorChat: () => void;
  onOpenFileVault: () => void;
  onOpenTranslation: () => void;
  onOpenModelCatalog: () => void;
  onManageModels: () => void;
  onDeleteAllChats: () => void;
  activeMode: "chat" | "translation";
  onClose: () => void;
}

interface ChatRowProps {
  item: ChatSummary;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onRename: () => void;
}

function ChatRow({
  item,
  isActive,
  onSelect,
  onDelete,
  onRename,
}: ChatRowProps): React.JSX.Element {
  const { colors } = useTheme();
  const rowStyles = useMemo(() => createRowStyles(colors), [colors]);
  const translateX = useRef(new Animated.Value(0)).current;

  const closeSwipe = () => {
    Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
      onMoveShouldSetPanResponderCapture: (_, g) =>
        Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
      onPanResponderMove: (_, g) => {
        const x = Math.max(-THREAD_ACTIONS_WIDTH, Math.min(0, g.dx));
        translateX.setValue(x);
      },
      onPanResponderRelease: (_, g) => {
        if (g.dx < -THREAD_ACTIONS_WIDTH / 2) {
          Animated.spring(translateX, {
            toValue: -THREAD_ACTIONS_WIDTH,
            useNativeDriver: true,
          }).start();
        } else {
          closeSwipe();
        }
      },
      onPanResponderTerminationRequest: () => false,
      onPanResponderTerminate: closeSwipe,
    }),
  ).current;

  return (
    <View style={rowStyles.container}>
      <View style={rowStyles.actionButtons}>
        {isLiquidGlassAvailable() ? (
          <GlassView isInteractive style={rowStyles.actionGlass}>
            <TouchableOpacity
              style={rowStyles.actionInner}
              onPress={() => {
                closeSwipe();
                onRename();
              }}
              activeOpacity={0.7}
            >
              <Ionicons name="pencil-outline" size={16} color={colors.accent} />
            </TouchableOpacity>
          </GlassView>
        ) : (
          <TouchableOpacity
            style={rowStyles.renameAction}
            onPress={() => {
              closeSwipe();
              onRename();
            }}
            activeOpacity={0.7}
          >
            <Ionicons name="pencil-outline" size={16} color={colors.accent} />
          </TouchableOpacity>
        )}

        {isLiquidGlassAvailable() ? (
          <GlassView isInteractive style={rowStyles.actionGlass}>
            <TouchableOpacity
              style={rowStyles.actionInner}
              onPress={() => {
                closeSwipe();
                onDelete();
              }}
              activeOpacity={0.7}
            >
              <Ionicons
                name="trash-outline"
                size={16}
                color={colors.destructive}
              />
            </TouchableOpacity>
          </GlassView>
        ) : (
          <TouchableOpacity
            style={rowStyles.deleteAction}
            onPress={() => {
              closeSwipe();
              onDelete();
            }}
            activeOpacity={0.7}
          >
            <Ionicons name="trash-outline" size={16} color="#FFFFFF" />
          </TouchableOpacity>
        )}
      </View>

      {/* Swipeable row */}
      <Animated.View
        style={[rowStyles.row, { transform: [{ translateX }] }]}
        {...panResponder.panHandlers}
      >
        <TouchableOpacity
          style={[rowStyles.inner, isActive && rowStyles.innerActive]}
          onPress={() => {
            closeSwipe();
            onSelect();
          }}
          activeOpacity={0.7}
        >
          <Text
            style={[rowStyles.text, isActive && rowStyles.textActive]}
            numberOfLines={1}
          >
            {item.title}
          </Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

function createRowStyles(colors: ColorPalette) {
  return StyleSheet.create({
    container: {
      marginHorizontal: SPACING.sm,
      marginVertical: 2,
      borderRadius: RADII.sm,
    },
    actionButtons: {
      position: "absolute",
      right: 8,
      top: 0,
      bottom: 0,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    actionGlass: {
      width: THREAD_ACTION_SIZE,
      height: THREAD_ACTION_SIZE,
      borderRadius: THREAD_ACTION_SIZE / 2,
      overflow: "hidden",
    },
    actionInner: {
      flex: 1,
      width: THREAD_ACTION_SIZE,
      alignItems: "center",
      justifyContent: "center",
    },
    renameAction: {
      width: THREAD_ACTION_SIZE,
      height: THREAD_ACTION_SIZE,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.surface,
      borderRadius: THREAD_ACTION_SIZE / 2,
      borderWidth: 1,
      borderColor: colors.accent,
    },
    deleteAction: {
      width: THREAD_ACTION_SIZE,
      height: THREAD_ACTION_SIZE,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.destructive,
      borderRadius: THREAD_ACTION_SIZE / 2,
    },
    row: {
      backgroundColor: colors.sidebar,
    },
    inner: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.md,
      borderRadius: RADII.sm,
    },
    innerActive: {
      backgroundColor: colors.surface,
    },
    text: {
      flex: 1,
      fontSize: 16,
      color: colors.textSecondary,
    },
    textActive: {
      color: colors.textPrimary,
      fontWeight: FONT.medium,
    },
  });
}

interface Section {
  title: string;
  data: ChatSummary[];
}

function areChatSummariesEqual(
  previous: ChatSummary[],
  next: ChatSummary[],
): boolean {
  if (previous === next) {
    return true;
  }

  if (previous.length !== next.length) {
    return false;
  }

  for (let index = 0; index < previous.length; index += 1) {
    const previousChat = previous[index];
    const nextChat = next[index];

    if (
      previousChat.id !== nextChat.id ||
      previousChat.title !== nextChat.title ||
      previousChat.createdAt !== nextChat.createdAt ||
      previousChat.mode !== nextChat.mode
    ) {
      return false;
    }
  }

  return true;
}

function areSidebarPropsEqual(
  previous: SidebarProps,
  next: SidebarProps,
): boolean {
  return (
    previous.width === next.width &&
    previous.visible === next.visible &&
    previous.activeChatId === next.activeChatId &&
    previous.activeMode === next.activeMode &&
    previous.onNewChat === next.onNewChat &&
    areChatSummariesEqual(previous.chats, next.chats)
  );
}

function groupChats(chats: ChatSummary[]): Section[] {
  const now = new Date();
  const todayStr = now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toDateString();

  const today: ChatSummary[] = [];
  const yesterdayList: ChatSummary[] = [];
  const older: ChatSummary[] = [];

  for (const chat of chats) {
    const d = new Date(chat.createdAt).toDateString();
    if (d === todayStr) today.push(chat);
    else if (d === yesterdayStr) yesterdayList.push(chat);
    else older.push(chat);
  }

  const sections: Section[] = [];
  if (today.length > 0) sections.push({ title: "Today", data: today });
  if (yesterdayList.length > 0)
    sections.push({ title: "Yesterday", data: yesterdayList });
  if (older.length > 0) sections.push({ title: "Previous", data: older });
  return sections;
}

function SidebarComponent({
  width = DEFAULT_SIDEBAR_WIDTH,
  visible,
  chats,
  activeChatId,
  onNewChat,
  onSelectChat,
  onDeleteChat,
  onRenameChat,
  onOpenTensorChat,
  onOpenFileVault,
  onOpenTranslation,
  onOpenModelCatalog,
  onManageModels,
  onDeleteAllChats,
  activeMode,
  onClose,
}: SidebarProps): React.JSX.Element | null {
  const { colors, scheme, preference, setPreference } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const glassScheme = scheme === "dark" ? "dark" : "light";
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [storageBytes, setStorageBytes] = useState<number | null>(null);
  const [modelCount, setModelCount] = useState(0);

  const scanStorage = useCallback(async () => {
    try {
      const dirInfo = await FileSystem.getInfoAsync(MODELS_DIR);
      if (!dirInfo.exists) {
        setStorageBytes(0);
        setModelCount(0);
        return;
      }
      const files = await FileSystem.readDirectoryAsync(MODELS_DIR);
      let total = 0;
      let count = 0;
      for (const name of files) {
        if (!name.endsWith(".gguf")) continue;
        const info = await FileSystem.getInfoAsync(MODELS_DIR + name);
        if (info.exists) {
          total += (info as { size?: number }).size ?? 0;
          count += 1;
        }
      }
      setStorageBytes(total);
      setModelCount(count);
    } catch {
      setStorageBytes(null);
      setModelCount(0);
    }
  }, []);

  useEffect(() => {
    if (settingsOpen) void scanStorage();
  }, [settingsOpen, scanStorage]);

  const cycleTheme = () => {
    const order: ThemePreference[] = ["light", "dark", "system"];
    setPreference(order[(order.indexOf(preference) + 1) % order.length]);
  };

  const themeIcon =
    preference === "light"
      ? "sunny-outline"
      : preference === "dark"
        ? "moon-outline"
        : "phone-portrait-outline";
  const insets = useSafeAreaInsets();

  const sections = groupChats(chats);
  const emptyHistoryTitle =
    activeMode === "translation" ? "No translation history yet" : "No chat history yet";
  const emptyHistoryDescription =
    activeMode === "translation"
      ? "Start a translation and saved threads will show up here for quick access."
      : "Start a conversation and saved threads will show up here for quick access.";
  const emptyHistoryActionLabel =
    activeMode === "translation" ? "Start translation" : "Start chat";
  const emptyHistoryIconName =
    activeMode === "translation"
      ? "language-outline"
      : "chatbubble-ellipses-outline";

  return (
    <View
      pointerEvents={visible ? "auto" : "none"}
      style={[styles.sidebar, { width, paddingTop: insets.top }]}
    >
      {/* Top area: search */}
      <View style={styles.topRow}>
        {isLiquidGlassAvailable() ? (
          <GlassView style={styles.searchBarGlass}>
            <Ionicons name="search" size={14} color={colors.textTertiary} />
            <Text style={styles.searchPlaceholder}>Search</Text>
          </GlassView>
        ) : (
          <View style={styles.searchBar}>
            <Ionicons name="search" size={14} color={colors.textTertiary} />
            <Text style={styles.searchPlaceholder}>Search</Text>
          </View>
        )}
      </View>

      {/* Nav section */}
      <View style={styles.navSection}>
        <TouchableOpacity
          style={[styles.navRow, activeMode === "chat" && styles.navRowActive]}
          onPress={() => {
            onOpenTensorChat();
            onClose();
          }}
          activeOpacity={0.7}
        >
          <View style={styles.navIcon}>
            <Image
              source={
                scheme === "light"
                  ? require("../../assets/tc-light-t.png")
                  : require("../../assets/tc-dark-t.png")
              }
              style={[
                styles.navBrandIcon,
                activeMode === "chat"
                  ? styles.navBrandIconActive
                  : styles.navBrandIconInactive,
              ]}
              resizeMode="contain"
            />
          </View>
          <Text
            style={[
              styles.navRowText,
              activeMode === "chat" && styles.navRowTextActive,
            ]}
          >
            TensorChat
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.navRow,
            activeMode === "translation" && styles.navRowActive,
          ]}
          onPress={() => {
            onOpenTranslation();
            onClose();
          }}
          activeOpacity={0.7}
        >
          <View style={styles.navIcon}>
            <Ionicons
              name="language-outline"
              size={20}
              color={
                activeMode === "translation"
                  ? colors.accent
                  : colors.textSecondary
              }
            />
          </View>
          <Text
            style={[
              styles.navRowText,
              activeMode === "translation" && styles.navRowTextActive,
            ]}
          >
            Translation
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.navRow}
          onPress={() => {
            onOpenModelCatalog();
            onClose();
          }}
          activeOpacity={0.7}
        >
          <View style={styles.navIcon}>
            <Ionicons
              name="albums-outline"
              size={20}
              color={colors.textSecondary}
            />
          </View>
          <Text style={styles.navRowText}>Model Catalog</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.navRow}
          onPress={() => {
            onOpenFileVault();
            onClose();
          }}
          activeOpacity={0.7}
        >
          <View style={styles.navIcon}>
            <MaterialCommunityIcons
              name="safe-square-outline"
              size={20}
              color={colors.textSecondary}
            />
          </View>
          <Text style={styles.navRowText}>File Vault</Text>
        </TouchableOpacity>
      </View>

      {/* Divider */}
      <View style={styles.divider} />

      {/* Chat history */}
      <View style={styles.historySection}>
        {sections.length === 0 ? (
          <View style={styles.emptyHistory}>
            <View style={styles.emptyHistoryCard}>
              <View style={styles.emptyHistoryCopy}>
                <Text style={styles.emptyHistoryTitle}>{emptyHistoryTitle}</Text>
                <Text style={styles.emptyHistoryText}>{emptyHistoryDescription}</Text>
              </View>
              <TouchableOpacity
                style={styles.emptyHistoryButton}
                onPress={onNewChat}
                activeOpacity={0.8}
              >
                <Ionicons name="add" size={16} color="#FFFFFF" />
                <Text style={styles.emptyHistoryButtonText}>
                  {emptyHistoryActionLabel}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <SectionList
            style={styles.historyList}
            sections={sections}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            stickySectionHeadersEnabled={false}
            renderSectionHeader={({ section }) => (
              <Text style={styles.sectionHeader}>{section.title}</Text>
            )}
            renderItem={({ item }) => (
              <ChatRow
                item={item}
                isActive={item.id === activeChatId}
                onSelect={() => {
                  onSelectChat(item.id);
                  onClose();
                }}
                onDelete={() => onDeleteChat(item.id)}
                onRename={() => onRenameChat(item.id)}
              />
            )}
          />
        )}
      </View>

      {/* Bottom bar: settings + theme toggle */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 8 }]}>
        {isLiquidGlassAvailable() ? (
          <GlassView
            isInteractive
            colorScheme={glassScheme}
            style={styles.themeGlass}
          >
            <TouchableOpacity
              style={styles.themeGlassInner}
              onPress={() => setSettingsOpen(true)}
              activeOpacity={0.8}
            >
              <Ionicons
                name="settings-outline"
                size={18}
                color={colors.textSecondary}
              />
            </TouchableOpacity>
          </GlassView>
        ) : (
          <TouchableOpacity
            style={styles.themeSolid}
            onPress={() => setSettingsOpen(true)}
            activeOpacity={0.8}
          >
            <Ionicons
              name="settings-outline"
              size={18}
              color={colors.textSecondary}
            />
          </TouchableOpacity>
        )}

        {isLiquidGlassAvailable() ? (
          <GlassView
            isInteractive
            colorScheme={glassScheme}
            style={styles.themeGlass}
          >
            <TouchableOpacity
              style={styles.themeGlassInner}
              onPress={cycleTheme}
              activeOpacity={0.8}
            >
              <Ionicons
                name={themeIcon}
                size={18}
                color={colors.textSecondary}
              />
            </TouchableOpacity>
          </GlassView>
        ) : (
          <TouchableOpacity
            style={styles.themeSolid}
            onPress={cycleTheme}
            activeOpacity={0.8}
          >
            <Ionicons name={themeIcon} size={18} color={colors.textSecondary} />
          </TouchableOpacity>
        )}
      </View>

      {/* Settings bottom sheet */}
      <Modal
        visible={settingsOpen}
        animationType="slide"
        transparent
        presentationStyle="overFullScreen"
        onRequestClose={() => setSettingsOpen(false)}
      >
        <Pressable
          style={styles.settingsOverlay}
          onPress={() => setSettingsOpen(false)}
        >
          <Pressable
            style={[styles.settingsSheet, { paddingBottom: insets.bottom + SPACING.xl }]}
            onPress={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <View style={styles.settingsHeader}>
              <View style={styles.settingsHandle} />
              <View style={styles.settingsHeaderRow}>
                <Text style={styles.settingsTitle}>Settings</Text>
                {isLiquidGlassAvailable() ? (
                  <GlassView
                    isInteractive
                    colorScheme={glassScheme}
                    style={styles.settingsCloseGlass}
                  >
                    <TouchableOpacity
                      style={styles.settingsCloseInner}
                      onPress={() => setSettingsOpen(false)}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="close" size={18} color={colors.textSecondary} />
                    </TouchableOpacity>
                  </GlassView>
                ) : (
                  <TouchableOpacity
                    style={styles.settingsCloseSolid}
                    onPress={() => setSettingsOpen(false)}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="close" size={18} color={colors.textSecondary} />
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {/* Storage */}
            <Text style={styles.settingsSectionLabel}>Storage</Text>
            <View style={styles.settingsGroup}>
              <View style={styles.storageRow}>
                <View style={styles.storageIconWrap}>
                  <Ionicons name="server-outline" size={20} color={colors.accent} />
                </View>
                <View style={styles.storageInfo}>
                  <Text style={styles.storageValue}>
                    {storageBytes !== null ? formatBytes(storageBytes) : "..."}
                  </Text>
                  <Text style={styles.storageLabel}>
                    {modelCount === 1
                      ? "1 model on device"
                      : `${modelCount} models on device`}
                  </Text>
                </View>
              </View>

              <View style={styles.settingsRowDivider} />

              <TouchableOpacity
                style={styles.settingsRow}
                onPress={() => {
                  setSettingsOpen(false);
                  onManageModels();
                  onClose();
                }}
                activeOpacity={0.7}
              >
                <Ionicons name="cube-outline" size={20} color={colors.textSecondary} />
                <Text style={styles.settingsRowText}>Manage Models</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
              </TouchableOpacity>

              <View style={styles.settingsRowDivider} />

              <TouchableOpacity
                style={styles.settingsRow}
                onPress={() => {
                  Alert.alert(
                    "Delete all chats",
                    "This will permanently delete all your chat and translation history. This cannot be undone.",
                    [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Delete All",
                        style: "destructive",
                        onPress: () => {
                          onDeleteAllChats();
                          setSettingsOpen(false);
                        },
                      },
                    ],
                  );
                }}
                activeOpacity={0.7}
              >
                <Ionicons name="trash-outline" size={20} color={colors.destructive} />
                <Text style={[styles.settingsRowText, { color: colors.destructive }]}>
                  Delete All Chats
                </Text>
              </TouchableOpacity>
            </View>

            {/* Spread the Word */}
            <Text style={styles.settingsSectionLabel}>Spread the Word</Text>
            <View style={styles.settingsGroup}>
              <TouchableOpacity
                style={styles.settingsRow}
                onPress={() => {
                  const appStoreUrl =
                    Platform.OS === "android"
                      ? "https://play.google.com/store/apps/details?id=io.tensorpath.chat"
                      : "https://apps.apple.com/us/app/tensorchat-private-ai/id6760141754";
                  void Share.share(
                    Platform.OS === "ios"
                      ? {
                          message: "Check out TensorChat — a privacy-first, on-device AI chat app!",
                          url: appStoreUrl,
                        }
                      : {
                          message: `Check out TensorChat — a privacy-first, on-device AI chat app! ${appStoreUrl}`,
                        },
                  );
                }}
                activeOpacity={0.7}
              >
                <Ionicons name="share-outline" size={20} color={colors.textSecondary} />
                <Text style={styles.settingsRowText}>Share TensorChat</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
              </TouchableOpacity>

              <View style={styles.settingsRowDivider} />

              <TouchableOpacity
                style={styles.settingsRow}
                onPress={() =>
                  void Linking.openURL("https://github.com/general-intelligence-inc/tensorchat")
                }
                activeOpacity={0.7}
              >
                <Ionicons name="logo-github" size={20} color={colors.textSecondary} />
                <Text style={styles.settingsRowText}>Star us on GitHub</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
              </TouchableOpacity>
            </View>

            {/* Legal */}
            <Text style={styles.settingsSectionLabel}>Legal</Text>
            <View style={styles.settingsGroup}>
              <TouchableOpacity
                style={styles.settingsRow}
                onPress={() => void Linking.openURL("https://tensorchat.app/terms")}
                activeOpacity={0.7}
              >
                <Ionicons name="document-text-outline" size={20} color={colors.textSecondary} />
                <Text style={styles.settingsRowText}>Terms & Conditions</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
              </TouchableOpacity>

              <View style={styles.settingsRowDivider} />

              <TouchableOpacity
                style={styles.settingsRow}
                onPress={() =>
                  void Linking.openURL("https://tensorchat.app/privacy")
                }
                activeOpacity={0.7}
              >
                <Ionicons name="shield-checkmark-outline" size={20} color={colors.textSecondary} />
                <Text style={styles.settingsRowText}>Privacy Policy</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
              </TouchableOpacity>
            </View>

            {/* About */}
            <Text style={styles.settingsSectionLabel}>About</Text>
            <View style={styles.settingsGroup}>
              <View style={styles.settingsRow}>
                <Ionicons name="information-circle-outline" size={20} color={colors.textSecondary} />
                <Text style={styles.settingsRowText}>Version</Text>
                <Text style={styles.settingsVersionText}>1.4.8</Text>
              </View>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

export const Sidebar = memo(SidebarComponent, areSidebarPropsEqual);

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    sidebar: {
      position: "absolute",
      top: 0,
      left: 0,
      bottom: 0,
      backgroundColor: colors.sidebar,
      borderRightWidth: StyleSheet.hairlineWidth,
      borderRightColor: colors.border,
      paddingRight: SPACING.lg,
      zIndex: 1,
    },

    // Top row: search
    topRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingLeft: SPACING.lg,
      paddingRight: SPACING.md,
      paddingTop: SPACING.md,
      paddingBottom: SPACING.sm,
      gap: SPACING.sm,
    },
    searchBar: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.surface,
      borderRadius: RADII.pill,
      paddingHorizontal: SPACING.md,
      paddingVertical: 8,
      gap: SPACING.xs,
    },
    searchBarGlass: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      borderRadius: RADII.pill,
      paddingHorizontal: SPACING.md,
      paddingVertical: 8,
      gap: SPACING.xs,
      overflow: "hidden",
    },
    searchPlaceholder: {
      fontSize: 15,
      color: colors.textTertiary,
    },

    // Nav section
    navSection: {
      paddingLeft: SPACING.md,
      paddingRight: SPACING.sm,
      paddingBottom: SPACING.sm,
    },
    navRowBrand: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: SPACING.sm,
      paddingVertical: SPACING.sm,
      borderRadius: RADII.sm,
      gap: SPACING.sm,
    },
    brandMonogram: {
      width: 28,
      height: 28,
      borderRadius: RADII.sm,
      backgroundColor: colors.accent,
      alignItems: "center",
      justifyContent: "center",
    },
    brandMonogramText: {
      fontSize: 14,
      fontWeight: FONT.bold,
      color: "#fff",
    },
    brandLabel: {
      fontSize: 15,
      fontWeight: FONT.semibold,
      color: colors.textPrimary,
    },
    navRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: SPACING.sm,
      paddingVertical: SPACING.sm,
      borderRadius: RADII.sm,
      gap: SPACING.sm,
    },
    navRowActive: {
      backgroundColor: colors.surface,
    },
    navIcon: {
      width: 28,
      height: 28,
      alignItems: "center",
      justifyContent: "center",
    },
    navBrandIcon: {
      width: 20,
      height: 20,
    },
    navBrandIconActive: {
      opacity: 1,
    },
    navBrandIconInactive: {
      opacity: 0.72,
    },
    navRowText: {
      fontSize: 17,
      fontWeight: FONT.medium,
      color: colors.textSecondary,
    },
    navRowTextActive: {
      color: colors.accent,
    },

    // Bottom bar
    bottomBar: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingLeft: SPACING.lg,
      paddingRight: SPACING.md,
      paddingTop: SPACING.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    themeGlass: {
      width: 36,
      height: 36,
      borderRadius: 18,
      overflow: "hidden",
    },
    themeGlassInner: {
      width: 36,
      height: 36,
      alignItems: "center",
      justifyContent: "center",
    },
    themeSolid: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.surface,
    },

    // Divider
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
      marginLeft: SPACING.lg,
      marginRight: SPACING.md,
      marginBottom: SPACING.sm,
    },

    // Chat history list
    historySection: {
      flex: 1,
      minHeight: 0,
    },
    historyList: {
      flex: 1,
    },
    listContent: {
      paddingBottom: SPACING.xl,
      paddingRight: SPACING.xs,
    },
    sectionHeader: {
      fontSize: 13,
      fontWeight: FONT.semibold,
      color: colors.textTertiary,
      paddingLeft: SPACING.xl,
      paddingRight: SPACING.lg,
      paddingTop: SPACING.md,
      paddingBottom: SPACING.xs,
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    emptyHistory: {
      flex: 1,
      justifyContent: "center",
      paddingLeft: SPACING.xl,
      paddingRight: SPACING.lg,
      paddingBottom: SPACING.xl,
    },
    emptyHistoryCard: {
      gap: SPACING.md,
      padding: SPACING.lg,
      backgroundColor: colors.surface,
      borderRadius: RADII.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    emptyHistoryIconWrap: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.accentTint,
    },
    emptyHistoryCopy: {
      gap: SPACING.xs,
    },
    emptyHistoryTitle: {
      fontSize: 16,
      fontWeight: FONT.semibold,
      color: colors.textPrimary,
    },
    emptyHistoryText: {
      fontSize: 14,
      lineHeight: 20,
      color: colors.textSecondary,
    },
    emptyHistoryButton: {
      alignSelf: "flex-start",
      flexDirection: "row",
      alignItems: "center",
      gap: SPACING.sm,
      paddingHorizontal: SPACING.md,
      paddingVertical: 10,
      borderRadius: RADII.pill,
      backgroundColor: colors.accent,
    },
    emptyHistoryButtonText: {
      fontSize: 14,
      fontWeight: FONT.medium,
      color: "#FFFFFF",
    },

    // Settings bottom sheet
    settingsOverlay: {
      flex: 1,
      backgroundColor: colors.overlayBg,
      justifyContent: "flex-end",
    },
    settingsSheet: {
      backgroundColor: colors.base,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      paddingHorizontal: SPACING.lg,
    },
    settingsHeader: {
      paddingTop: SPACING.sm,
      paddingBottom: SPACING.xs,
    },
    settingsHandle: {
      width: 36,
      height: 5,
      borderRadius: 3,
      backgroundColor: colors.border,
      alignSelf: "center",
      marginBottom: SPACING.md,
    },
    settingsHeaderRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    settingsTitle: {
      fontSize: 20,
      fontWeight: FONT.bold,
      color: colors.textPrimary,
    },
    settingsCloseGlass: {
      width: 30,
      height: 30,
      borderRadius: 15,
      overflow: "hidden",
    },
    settingsCloseInner: {
      width: 30,
      height: 30,
      alignItems: "center",
      justifyContent: "center",
    },
    settingsCloseSolid: {
      width: 30,
      height: 30,
      borderRadius: 15,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.surface,
    },
    storageRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: SPACING.md,
      paddingVertical: SPACING.md,
      paddingHorizontal: SPACING.md,
    },
    storageIconWrap: {
      width: 36,
      height: 36,
      borderRadius: RADII.sm,
      backgroundColor: colors.accentTint,
      alignItems: "center",
      justifyContent: "center",
    },
    storageInfo: {
      flex: 1,
      gap: 2,
    },
    storageValue: {
      fontSize: 14,
      fontWeight: FONT.medium,
      color: colors.textSecondary,
    },
    storageLabel: {
      fontSize: 13,
      color: colors.textTertiary,
    },
    settingsSectionLabel: {
      fontSize: 13,
      fontWeight: FONT.semibold,
      color: colors.textTertiary,
      textTransform: "uppercase",
      letterSpacing: 0.5,
      marginTop: SPACING.lg,
      marginBottom: SPACING.sm,
      paddingHorizontal: SPACING.xs,
    },
    settingsGroup: {
      backgroundColor: colors.surface,
      borderRadius: RADII.md,
      overflow: "hidden",
    },
    settingsRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: SPACING.md,
      paddingVertical: SPACING.md,
      paddingHorizontal: SPACING.md,
    },
    settingsRowDivider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
      marginLeft: SPACING.md + 20 + SPACING.md,
    },
    settingsRowText: {
      flex: 1,
      fontSize: 16,
      color: colors.textPrimary,
    },
    settingsVersionText: {
      fontSize: 14,
      color: colors.textTertiary,
    },
  });
}
