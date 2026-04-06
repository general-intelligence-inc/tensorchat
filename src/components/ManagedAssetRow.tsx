import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { ColorPalette, FONT, RADII, SPACING } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';

const DELETE_WIDTH = 56;
const ACTIONS_WIDTH = 96;

interface ManagedAssetRowProps {
  title: string;
  subtitle: string;
  sizeLabel: string;
  badge?: string;
  isDownloaded: boolean;
  isLoaded?: boolean;
  isLoading?: boolean;
  downloadProgress: number | null;
  onDownload: () => void;
  onLoad?: () => void;
  onDelete: () => void;
  disabled?: boolean;
  loadDisabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function ManagedAssetRow({
  title,
  subtitle,
  sizeLabel,
  badge,
  isDownloaded,
  isLoaded = false,
  isLoading = false,
  downloadProgress,
  onDownload,
  onLoad,
  onDelete,
  disabled = false,
  loadDisabled = false,
  style,
}: ManagedAssetRowProps): React.JSX.Element {
  const { colors, scheme } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const glassScheme = scheme === 'dark' ? 'dark' : 'light';
  const fillWidth = useRef(new Animated.Value(0)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const isDownloadedRef = useRef(isDownloaded);
  const disabledRef = useRef(disabled);
  const [rowWidth, setRowWidth] = useState(0);
  const isDownloading = downloadProgress !== null;
  const canLoad = typeof onLoad === 'function';
  const swipeWidth = canLoad ? ACTIONS_WIDTH : DELETE_WIDTH;

  useEffect(() => {
    isDownloadedRef.current = isDownloaded;
  }, [isDownloaded]);

  useEffect(() => {
    disabledRef.current = disabled;
    if (!isDownloaded || disabled) {
      Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
    }
  }, [disabled, isDownloaded, translateX]);

  useEffect(() => {
    if (isDownloading && rowWidth > 0) {
      fillWidth.setValue((downloadProgress ?? 0) * rowWidth);
    } else {
      fillWidth.setValue(0);
    }
  }, [downloadProgress, fillWidth, isDownloading, rowWidth]);

  const closeSwipe = () => {
    Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: (_, gestureState) =>
        isDownloadedRef.current &&
        !disabledRef.current &&
        Math.abs(gestureState.dx) > 6 &&
        Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 2,
      onMoveShouldSetPanResponderCapture: (_, gestureState) =>
        isDownloadedRef.current &&
        !disabledRef.current &&
        Math.abs(gestureState.dx) > 6 &&
        Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 2,
      onPanResponderMove: (_, gestureState) => {
        const nextX = Math.max(-swipeWidth, Math.min(0, gestureState.dx));
        translateX.setValue(nextX);
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dx < -swipeWidth / 2) {
          Animated.spring(translateX, {
            toValue: -swipeWidth,
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
    <View style={style}>
      <View style={styles.swipeContainer}>
        {isDownloaded ? (
          <View style={styles.actionButtons}>
            {canLoad ? (
              isLiquidGlassAvailable() ? (
                <GlassView
                  isInteractive
                  colorScheme={glassScheme}
                  style={styles.actionGlass}
                >
                  <TouchableOpacity
                    style={[
                      styles.actionInner,
                      loadDisabled ? styles.buttonDisabled : null,
                    ]}
                    onPress={onLoad}
                    disabled={loadDisabled}
                    activeOpacity={0.8}
                  >
                    <Ionicons
                      name={loadDisabled ? 'lock-closed-outline' : 'refresh'}
                      size={16}
                      color={loadDisabled ? colors.textTertiary : colors.accent}
                    />
                  </TouchableOpacity>
                </GlassView>
              ) : (
                <TouchableOpacity
                  style={[
                    styles.reloadFallback,
                    loadDisabled ? styles.buttonDisabled : null,
                  ]}
                  onPress={onLoad}
                  disabled={loadDisabled}
                  activeOpacity={0.8}
                >
                  <Ionicons
                    name={loadDisabled ? 'lock-closed-outline' : 'refresh'}
                    size={16}
                    color={loadDisabled ? colors.textTertiary : colors.accent}
                  />
                </TouchableOpacity>
              )
            ) : null}

            {isLiquidGlassAvailable() ? (
              <GlassView
                isInteractive
                colorScheme={glassScheme}
                style={[styles.actionGlass, disabled ? styles.buttonDisabled : null]}
              >
                <TouchableOpacity
                  style={styles.actionInner}
                  onPress={onDelete}
                  disabled={disabled}
                  activeOpacity={0.8}
                >
                  <Ionicons name="trash-outline" size={16} color={colors.destructive} />
                </TouchableOpacity>
              </GlassView>
            ) : (
              <TouchableOpacity
                style={[styles.deleteFallback, disabled ? styles.buttonDisabled : null]}
                onPress={onDelete}
                disabled={disabled}
                activeOpacity={0.8}
              >
                <Ionicons name="trash-outline" size={16} color={colors.base} />
              </TouchableOpacity>
            )}
          </View>
        ) : null}

        <Animated.View
          style={[styles.swipeRow, { transform: [{ translateX }] }]}
          {...panResponder.panHandlers}
        >
          <TouchableOpacity
            style={styles.card}
            onPress={closeSwipe}
            activeOpacity={0.8}
            onLayout={(event) => setRowWidth(event.nativeEvent.layout.width)}
          >
            {isDownloading ? (
              <Animated.View
                style={[StyleSheet.absoluteFillObject, styles.fill, { width: fillWidth }]}
                pointerEvents="none"
              />
            ) : null}

            <View style={styles.main}>
              <View style={styles.left}>
                <View style={styles.titleRow}>
                  <Text style={styles.title}>{title}</Text>
                  <View style={styles.sizeBadge}>
                    <Text style={styles.sizeBadgeText}>{sizeLabel}</Text>
                  </View>
                  {badge ? (
                    <Text style={styles.recommendedBadge}>{badge}</Text>
                  ) : null}
                </View>
                <Text style={styles.subtitle}>{subtitle}</Text>
              </View>

              <View style={styles.right}>
                {isDownloading ? (
                  <Text style={styles.progressText}>
                    {Math.round((downloadProgress ?? 0) * 100)}%
                  </Text>
                ) : isLoading ? (
                  <ActivityIndicator size="small" color={colors.accent} />
                ) : isDownloaded && isLoaded ? (
                  <Ionicons name="checkmark-circle" size={20} color={colors.accent} />
                ) : isDownloaded && canLoad ? (
                  <TouchableOpacity
                    onPress={onLoad}
                    hitSlop={12}
                    style={[styles.downloadButton, loadDisabled ? styles.buttonDisabled : null]}
                    disabled={loadDisabled}
                    activeOpacity={0.8}
                  >
                    <Ionicons
                      name={loadDisabled ? 'lock-closed-outline' : 'play-circle-outline'}
                      size={20}
                      color={loadDisabled ? colors.textTertiary : colors.accent}
                    />
                  </TouchableOpacity>
                ) : isDownloaded ? (
                  <Ionicons name="checkmark-circle" size={20} color={colors.accent} />
                ) : (
                  <TouchableOpacity
                    onPress={onDownload}
                    hitSlop={12}
                    style={[styles.downloadButton, disabled ? styles.buttonDisabled : null]}
                    disabled={disabled}
                    activeOpacity={0.8}
                  >
                    <Ionicons
                      name="cloud-download-outline"
                      size={20}
                      color={colors.textTertiary}
                    />
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </View>
  );
}

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    swipeContainer: {
      borderRadius: RADII.sm,
      overflow: 'hidden',
    },
    actionButtons: {
      position: 'absolute',
      right: 8,
      top: 0,
      bottom: 0,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    actionGlass: {
      width: 36,
      height: 36,
      borderRadius: 18,
      overflow: 'hidden',
    },
    actionInner: {
      flex: 1,
      width: 36,
      alignItems: 'center',
      justifyContent: 'center',
    },
    deleteFallback: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.destructive,
      alignItems: 'center',
      justifyContent: 'center',
    },
    reloadFallback: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    swipeRow: {
      backgroundColor: colors.surface,
      borderRadius: RADII.sm,
    },
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: RADII.sm,
      padding: SPACING.md,
      overflow: 'hidden',
    },
    fill: {
      backgroundColor: colors.accentTint,
    },
    main: {
      flexDirection: 'row',
      alignItems: 'center',
      flex: 1,
    },
    left: {
      flex: 1,
      minWidth: 0,
    },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 8,
    },
    title: {
      flexShrink: 1,
      fontSize: 14,
      fontWeight: FONT.semibold,
      color: colors.textPrimary,
    },
    recommendedBadge: {
      fontSize: 11,
      color: colors.textSecondary,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: RADII.sm,
      paddingHorizontal: 5,
      paddingVertical: 1,
    },
    sizeBadge: {
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: RADII.sm,
      backgroundColor: colors.borderSubtle,
      flexShrink: 0,
      overflow: 'hidden',
    },
    sizeBadgeText: {
      fontSize: 11,
      fontWeight: FONT.semibold,
      color: colors.textTertiary,
    },
    subtitle: {
      marginTop: 2,
      fontSize: 12,
      color: colors.textSecondary,
    },
    right: {
      width: 40,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    downloadButton: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    progressText: {
      minWidth: 32,
      fontSize: 12,
      fontWeight: FONT.semibold,
      color: colors.accent,
      textAlign: 'right',
    },
    buttonDisabled: {
      opacity: 0.5,
    },
  });
}