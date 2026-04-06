import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Alert,
  FlatList,
  PanResponder,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Feather from '@expo/vector-icons/Feather';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { ManagedAssetRow } from '../components/ManagedAssetRow';
import { ColorPalette, FONT, RADII, SPACING } from '../constants/theme';
import { useFileRagContext } from '../context/FileRagContext';
import { useTheme } from '../context/ThemeContext';
import { useEmbeddingModelAsset } from '../hooks/useEmbeddingModelAsset';
import type { RagSource } from '../types/fileRag';
import { SUPPORTED_DOCUMENT_LABEL_TEXT } from '../utils/fileReaders';

const DELETE_WIDTH = 52;

interface FileVaultScreenProps {
  activeSourceIds: string[];
  onClose: () => void;
  onUpload: () => void;
  onDeleteSource: (sourceId: string) => Promise<void>;
  onToggleSource: (sourceId: string) => void;
}

function formatFileSize(bytes: number | null): string {
  if (!bytes || Number.isNaN(bytes)) {
    return 'Unknown size';
  }

  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${bytes} B`;
}

function getSourceTypeLabel(source: RagSource): string {
  switch (source.type) {
    case 'pdf':
      return 'PDF';
    case 'txt':
      return 'TXT';
    case 'md':
      return 'Markdown';
    case 'html':
      return 'HTML';
  }
}

function getSourceMeta(source: RagSource): string {
  const parts = [
    formatFileSize(source.size),
    getSourceTypeLabel(source),
    `${source.chunkCount} ${source.chunkCount === 1 ? 'chunk' : 'chunks'}`,
  ];

  return parts.join(' • ');
}

interface SourceRowProps {
  source: RagSource;
  isAttached: boolean;
  disabled: boolean;
  attachDisabled: boolean;
  isDeleting: boolean;
  onToggleSource: (sourceId: string) => void;
  onDeleteSource: (sourceId: string) => Promise<void>;
}

function SourceRow({
  source,
  isAttached,
  disabled,
  attachDisabled,
  isDeleting,
  onToggleSource,
  onDeleteSource,
}: SourceRowProps): React.JSX.Element {
  const { colors, scheme } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const glassScheme = scheme === 'dark' ? 'dark' : 'light';
  const translateX = useRef(new Animated.Value(0)).current;
  const disabledRef = useRef(disabled);
  const attachButtonDisabled = disabled || attachDisabled;

  useEffect(() => {
    disabledRef.current = disabled;
    if (disabled) {
      Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
    }
  }, [disabled, translateX]);

  const closeSwipe = () => {
    Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
  };

  const handleDelete = () => {
    if (disabled) {
      return;
    }

    closeSwipe();
    Alert.alert(
      'Delete file',
      `Delete ${source.name} from the File Vault?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void onDeleteSource(source.id);
          },
        },
      ],
    );
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: (_, gestureState) =>
        !disabledRef.current &&
        Math.abs(gestureState.dx) > 6 &&
        Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.5,
      onMoveShouldSetPanResponderCapture: (_, gestureState) =>
        !disabledRef.current &&
        Math.abs(gestureState.dx) > 6 &&
        Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.5,
      onPanResponderMove: (_, gestureState) => {
        const nextX = Math.max(-DELETE_WIDTH, Math.min(0, gestureState.dx));
        translateX.setValue(nextX);
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dx < -DELETE_WIDTH / 2) {
          Animated.spring(translateX, {
            toValue: -DELETE_WIDTH,
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
    <View style={styles.sourceSwipeContainer}>
      <View style={styles.sourceActionButtons}>
        {isLiquidGlassAvailable() ? (
          <GlassView
            isInteractive
            colorScheme={glassScheme}
            style={[
              styles.sourceActionGlass,
              disabled && !isDeleting ? styles.buttonDisabled : null,
            ]}
          >
            <TouchableOpacity
              style={styles.sourceActionInner}
              onPress={handleDelete}
              disabled={disabled}
              activeOpacity={0.8}
            >
              {isDeleting ? (
                <ActivityIndicator size="small" color={colors.destructive} />
              ) : (
                <Ionicons name="trash-outline" size={16} color={colors.destructive} />
              )}
            </TouchableOpacity>
          </GlassView>
        ) : (
          <TouchableOpacity
            style={[
              styles.sourceDeleteFallback,
              disabled && !isDeleting ? styles.buttonDisabled : null,
            ]}
            onPress={handleDelete}
            disabled={disabled}
            activeOpacity={0.8}
          >
            {isDeleting ? (
              <ActivityIndicator size="small" color={colors.base} />
            ) : (
              <Ionicons name="trash-outline" size={16} color={colors.base} />
            )}
          </TouchableOpacity>
        )}
      </View>

      <Animated.View
        style={[styles.sourceSwipeRow, { transform: [{ translateX }] }]}
        {...panResponder.panHandlers}
      >
        <TouchableOpacity
          activeOpacity={1}
          onPress={closeSwipe}
          style={[styles.sourceCard, isAttached ? styles.sourceCardAttached : null]}
        >
          <View style={styles.sourceMain}>
            <View style={styles.sourceTopRow}>
              <View style={styles.sourceBody}>
                <View style={styles.sourceTitleRow}>
                  <Text style={styles.sourceTitle} numberOfLines={1}>
                    {source.name}
                  </Text>
                </View>
                <Text style={styles.sourceMeta} numberOfLines={1}>
                  {getSourceMeta(source)}
                </Text>
              </View>

              <View style={styles.sourceUseColumn}>
                <TouchableOpacity
                  style={[
                    styles.attachButton,
                    isAttached ? styles.attachButtonActive : null,
                    attachButtonDisabled ? styles.buttonDisabled : null,
                  ]}
                  onPress={attachButtonDisabled ? undefined : () => onToggleSource(source.id)}
                  disabled={attachButtonDisabled}
                  activeOpacity={attachButtonDisabled ? 1 : 0.8}
                  hitSlop={8}
                >
                  <Ionicons
                    name={isAttached ? 'checkbox' : 'square-outline'}
                    size={21}
                    color={
                      isAttached
                        ? colors.accent
                        : attachButtonDisabled
                          ? colors.textTertiary
                          : colors.textSecondary
                    }
                  />
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

function IndexingSourceRow({ sourceName }: { sourceName: string }): React.JSX.Element {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.indexingRowWrap}>
      <View style={styles.sourceCard}>
        <View style={styles.sourceMain}>
          <View style={styles.sourceTopRow}>
            <View style={styles.sourceBody}>
              <Text style={styles.sourceTitle} numberOfLines={1}>
                {sourceName}
              </Text>
              <Text style={styles.sourceMeta} numberOfLines={1}>
                 Local indexing...
              </Text>
            </View>

            <View style={styles.sourceUseColumn}>
              <View style={styles.indexingSpinnerWrap}>
                <ActivityIndicator size="small" color={colors.accent} />
              </View>
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

function TableHeaderRow(): React.JSX.Element {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.tableHeaderRow}>
      <Text style={[styles.tableHeaderLabel, styles.tableHeaderFile]}>Name</Text>
      <Text style={[styles.tableHeaderLabel, styles.tableHeaderUse]}>Select</Text>
    </View>
  );
}

export function FileVaultScreen({
  activeSourceIds,
  onClose,
  onUpload,
  onDeleteSource,
  onToggleSource,
}: FileVaultScreenProps): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const { colors, scheme } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const glassScheme = scheme === 'dark' ? 'dark' : 'light';
  const {
    sources,
    statusMessage,
    indexingSourceName,
    error,
    isBusy,
    clearError,
    isEmbeddingModelEnabled,
  } = useFileRagContext();
  const {
    isDownloaded: isEmbeddingModelDownloaded,
    downloadProgress: embeddingModelDownloadProgress,
    download: handleDownloadEmbeddingModel,
    requestDelete: handleDeleteEmbeddingModel,
  } = useEmbeddingModelAsset();
  const [search, setSearch] = useState('');
  const [deletingSourceId, setDeletingSourceId] = useState<string | null>(null);
  const attachedSourceId = activeSourceIds[0] ?? null;
  const readyToChatVisible = attachedSourceId !== null;
  const readyToChatBottomOffset = Math.max(insets.bottom, SPACING.lg);

  const filteredSources = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    if (!normalizedSearch) {
      return sources;
    }

    return sources.filter((source) =>
      source.name.toLowerCase().includes(normalizedSearch),
    );
  }, [search, sources]);
  const sourceActionDisabled = isBusy || deletingSourceId !== null;
  const uploadDisabled = sourceActionDisabled || !isEmbeddingModelDownloaded;
  const embeddingAssetActionDisabled = sourceActionDisabled;
  const showTableHeader = filteredSources.length > 0 || !!indexingSourceName;
  const visibleStatusMessage =
    isEmbeddingModelDownloaded &&
    isEmbeddingModelEnabled &&
    !indexingSourceName &&
    !deletingSourceId
      ? statusMessage
      : null;

  const handleDeleteIndexedSource = useCallback(
    async (sourceId: string) => {
      setDeletingSourceId(sourceId);

      try {
        await onDeleteSource(sourceId);
      } finally {
        setDeletingSourceId((current) =>
          current === sourceId ? null : current,
        );
      }
    },
    [onDeleteSource],
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right', 'bottom']}>
      <View style={styles.header}>
        {isLiquidGlassAvailable() ? (
          <GlassView isInteractive colorScheme={glassScheme} style={styles.headerGlassButton}>
            <TouchableOpacity
              onPress={onClose}
              activeOpacity={0.8}
              style={styles.headerGlassInner}
            >
              <Ionicons name="close" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </GlassView>
        ) : (
          <TouchableOpacity onPress={onClose} activeOpacity={0.8} style={styles.headerButtonSolid}>
            <Ionicons name="close" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        )}

        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>File Vault</Text>
        </View>

        {isLiquidGlassAvailable() ? (
          <GlassView isInteractive colorScheme={glassScheme} style={styles.headerGlassButton}>
            <TouchableOpacity
              onPress={onUpload}
              activeOpacity={0.8}
              style={[styles.headerGlassInner, uploadDisabled ? styles.buttonDisabled : null]}
              disabled={uploadDisabled}
            >
              <Feather
                name="upload"
                size={18}
                color={uploadDisabled ? colors.textTertiary : colors.accent}
              />
            </TouchableOpacity>
          </GlassView>
        ) : (
          <TouchableOpacity
            onPress={onUpload}
            activeOpacity={0.8}
            style={[styles.headerButtonSolid, uploadDisabled ? styles.buttonDisabled : null]}
            disabled={uploadDisabled}
          >
            <Feather
              name="upload"
              size={18}
              color={uploadDisabled ? colors.textTertiary : colors.accent}
            />
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.searchWrap}>
        <Ionicons name="search" size={16} color={colors.textTertiary} />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search indexed files"
          placeholderTextColor={colors.textTertiary}
        />
      </View>

      {!isEmbeddingModelDownloaded || embeddingModelDownloadProgress !== null ? (
        <ManagedAssetRow
          style={styles.embeddingAssetWrap}
          title="EmbeddingGemma 300M"
          subtitle="Required for File Vault indexing and semantic retrieval."
          sizeLabel="~265 MB"
          isDownloaded={isEmbeddingModelDownloaded}
          downloadProgress={embeddingModelDownloadProgress}
          disabled={embeddingAssetActionDisabled}
          onDownload={handleDownloadEmbeddingModel}
          onDelete={handleDeleteEmbeddingModel}
        />
      ) : null}

      {visibleStatusMessage ? (
        <View style={styles.statusBanner}>
          <Ionicons name="sync-outline" size={16} color={colors.accent} />
          <Text style={styles.statusBannerText}>{visibleStatusMessage}</Text>
        </View>
      ) : null}

      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>{error}</Text>
          <TouchableOpacity onPress={clearError} hitSlop={8}>
            <Ionicons name="close" size={16} color={colors.errorText} />
          </TouchableOpacity>
        </View>
      ) : null}

      <FlatList
        data={filteredSources}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[
          styles.listContent,
          readyToChatVisible
            ? { paddingBottom: SPACING.xxl + 84 + readyToChatBottomOffset }
            : null,
          filteredSources.length === 0 && !indexingSourceName ? styles.listContentEmpty : null,
        ]}
        ListHeaderComponent={
          showTableHeader ? (
            <>
              <TableHeaderRow />
              {indexingSourceName ? <IndexingSourceRow sourceName={indexingSourceName} /> : null}
            </>
          ) : null
        }
        renderItem={({ item }) => (
          <SourceRow
            source={item}
            isAttached={activeSourceIds.includes(item.id)}
            disabled={sourceActionDisabled}
            attachDisabled={attachedSourceId !== null && attachedSourceId !== item.id}
            isDeleting={deletingSourceId === item.id}
            onToggleSource={onToggleSource}
            onDeleteSource={handleDeleteIndexedSource}
          />
        )}
        ListEmptyComponent={
          indexingSourceName ? null : (
            <View style={styles.emptyState}>
              <MaterialCommunityIcons
                name="safe-square-outline"
                size={28}
                color={colors.textTertiary}
              />
              <Text style={styles.emptyTitle}>
                {sources.length === 0 ? 'No files yet' : 'No matching files'}
              </Text>
              <Text style={styles.emptySubtitle}>
                {sources.length === 0
                  ? `Add ${SUPPORTED_DOCUMENT_LABEL_TEXT} files to build an on-device reference vault.`
                  : 'Try a different search term or clear the search input.'}
              </Text>
            </View>
          )
        }
      />

      {readyToChatVisible ? (
        <View
          style={[styles.readyToChatWrap, { bottom: readyToChatBottomOffset }]}
          pointerEvents="box-none"
        >
          <TouchableOpacity
            style={styles.readyToChatCard}
            onPress={onClose}
            activeOpacity={0.85}
          >
            <View style={styles.readyToChatIcon}>
              <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.accent} />
            </View>
            <View style={styles.readyToChatBody}>
              <Text style={styles.readyToChatTitle}>Ready to Chat</Text>
            </View>
            <View style={styles.readyToChatTrailing}>
              <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
            </View>
          </TouchableOpacity>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: colors.base,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: SPACING.lg,
      paddingVertical: SPACING.sm,
    },
    headerGlassButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      overflow: 'hidden',
    },
    headerGlassInner: {
      width: 36,
      height: 36,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerButtonSolid: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerCenter: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerTitle: {
      fontSize: 17,
      fontWeight: FONT.semibold,
      color: colors.textPrimary,
    },
    searchWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      marginHorizontal: SPACING.lg,
      marginTop: SPACING.xs,
      paddingHorizontal: SPACING.md,
      paddingVertical: 10,
      borderRadius: RADII.pill,
      backgroundColor: colors.surface,
      gap: SPACING.sm,
    },
    searchInput: {
      flex: 1,
      color: colors.textPrimary,
      fontSize: 15,
      paddingVertical: 0,
    },
    statusBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACING.sm,
      marginHorizontal: SPACING.lg,
      marginTop: SPACING.sm,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      borderRadius: RADII.md,
      backgroundColor: colors.accentTint,
    },
    statusBannerText: {
      flex: 1,
      color: colors.textPrimary,
      fontSize: 13,
    },
    errorBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACING.sm,
      marginHorizontal: SPACING.lg,
      marginTop: SPACING.sm,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      borderRadius: RADII.md,
      backgroundColor: colors.errorBarBg,
      borderWidth: 1,
      borderColor: colors.errorBarBorder,
    },
    errorBannerText: {
      flex: 1,
      color: colors.errorText,
      fontSize: 12,
    },
    listContent: {
      paddingHorizontal: SPACING.lg,
      paddingTop: SPACING.sm,
      paddingBottom: SPACING.xxl,
    },
    listContentEmpty: {
      flexGrow: 1,
      justifyContent: 'center',
    },
    tableHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingLeft: SPACING.sm,
      paddingRight: SPACING.sm,
      paddingVertical: 7,
      backgroundColor: colors.base,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    tableHeaderLabel: {
      fontSize: 13,
      fontWeight: FONT.semibold,
      color: colors.textPrimary,
    },
    tableHeaderFile: {
      flex: 1,
    },
    tableHeaderUse: {
      width: 44,
      textAlign: 'center',
    },
    sourceSwipeContainer: {
      borderRadius: 0,
      overflow: 'hidden',
    },
    indexingRowWrap: {
      marginBottom: 0,
    },
    embeddingAssetWrap: {
      marginHorizontal: SPACING.lg,
      marginTop: SPACING.sm,
    },
    sourceActionButtons: {
      position: 'absolute',
      right: 8,
      top: 0,
      bottom: 0,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sourceActionGlass: {
      width: 30,
      height: 30,
      borderRadius: 15,
      overflow: 'hidden',
    },
    sourceActionInner: {
      flex: 1,
      width: 30,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sourceDeleteFallback: {
      width: 30,
      height: 30,
      borderRadius: 15,
      backgroundColor: colors.destructive,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sourceSwipeRow: {
      backgroundColor: colors.base,
    },
    sourceCard: {
      borderRadius: 0,
      backgroundColor: colors.base,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    sourceCardAttached: {
      backgroundColor: colors.accentTint,
    },
    sourceMain: {
      paddingLeft: SPACING.sm,
      paddingRight: SPACING.sm,
      paddingVertical: 9,
    },
    sourceTopRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACING.sm,
    },
    sourceBody: {
      flex: 1,
      minWidth: 0,
    },
    sourceUseColumn: {
      width: 44,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    indexingSpinnerWrap: {
      width: 28,
      height: 28,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    sourceTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    sourceTitle: {
      flex: 1,
      fontSize: 15,
      fontWeight: FONT.medium,
      color: colors.textPrimary,
    },
    sourceMeta: {
      marginTop: 3,
      fontSize: 12,
      color: colors.textSecondary,
    },
    attachButton: {
      backgroundColor: 'transparent',
      alignItems: 'center',
      justifyContent: 'center',
      width: 28,
      height: 28,
      borderRadius: 14,
    },
    attachButtonActive: {
      backgroundColor: colors.surface,
    },
    buttonDisabled: {
      opacity: 0.5,
    },
    readyToChatWrap: {
      position: 'absolute',
      left: SPACING.lg,
      right: SPACING.lg,
    },
    readyToChatCard: {
      backgroundColor: colors.surface,
      borderRadius: 20,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm + 2,
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACING.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      boxShadow: '0 10px 24px rgba(0, 0, 0, 0.12)',
    },
    readyToChatIcon: {
      width: 36,
      height: 36,
      borderRadius: RADII.full,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accentTint,
      flexShrink: 0,
    },
    readyToChatBody: {
      flex: 1,
      alignItems: 'center',
    },
    readyToChatTitle: {
      fontSize: 14,
      fontWeight: FONT.semibold,
      color: colors.textPrimary,
      textAlign: 'center',
    },
    readyToChatTrailing: {
      width: 36,
      height: 36,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    emptyState: {
      alignItems: 'center',
      gap: SPACING.md,
      paddingHorizontal: SPACING.xxl,
    },
    emptyTitle: {
      fontSize: 18,
      fontWeight: FONT.semibold,
      color: colors.textPrimary,
      textAlign: 'center',
    },
    emptySubtitle: {
      fontSize: 14,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 20,
    },
  });
}