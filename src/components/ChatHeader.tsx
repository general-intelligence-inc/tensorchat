import React, { memo, useMemo } from 'react';
import {
  Animated,
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { ColorPalette, FONT, RADII, SPACING } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';

interface ChatHeaderProps {
  isLoading: boolean;
  isGenerating: boolean;
  incognitoActive: boolean;
  loadedModelName: string | null;
  modelPickerVisible: boolean;
  chevronAnim: Animated.Value;
  modelPillRef: React.RefObject<View | null>;
  topInset: number;
  onMenuPress: () => void;
  onModelPillPress: () => void;
  onStartIncognitoChat: () => void;
  onNewChat: () => void;
}

function ChatHeaderComponent({
  isLoading,
  isGenerating,
  incognitoActive,
  loadedModelName,
  chevronAnim,
  modelPillRef,
  topInset,
  onMenuPress,
  onModelPillPress,
  onStartIncognitoChat,
  onNewChat,
}: ChatHeaderProps): React.JSX.Element {
  const { colors, scheme } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const glassScheme = scheme === 'dark' ? 'dark' : 'light';

  const chevronRotate = chevronAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  });

  const modelPillContent = isLoading ? (
    <>
      <ActivityIndicator size="small" color={colors.accent} style={{ marginRight: 7 }} />
      <Text style={styles.modelPillText}>Loading…</Text>
    </>
  ) : loadedModelName ? (
    <>
      <View style={styles.loadedDot} />
      <Text style={styles.modelPillText} numberOfLines={1}>{loadedModelName}</Text>
      <Animated.View style={{ transform: [{ rotate: chevronRotate }], marginLeft: 4 }}>
        <Ionicons name="chevron-down" size={12} color={colors.textTertiary} />
      </Animated.View>
    </>
  ) : (
    <>
      <Text style={styles.modelPillHint}>Select a model</Text>
      <Animated.View style={{ transform: [{ rotate: chevronRotate }], marginLeft: 4 }}>
        <Ionicons name="chevron-down" size={12} color={colors.textTertiary} />
      </Animated.View>
    </>
  );

  return (
    isLiquidGlassAvailable() ? (
      <View style={[styles.glassHeader, styles.glassHeaderSolid, { paddingTop: topInset }]}>
        <View style={styles.modelBar}>
          <View style={styles.sideSlot}>
            <GlassView isInteractive colorScheme={glassScheme} style={styles.iconGlass}>
              <TouchableOpacity style={styles.iconGlassInner} onPress={onMenuPress} hitSlop={10}>
                <MaterialCommunityIcons name="menu" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </GlassView>
          </View>

          <View ref={modelPillRef} style={styles.modelBarCenter}>
            <GlassView isInteractive colorScheme={glassScheme} style={styles.modelPillGlass}>
              <TouchableOpacity
                testID="model-picker"
                style={styles.modelPill}
                onPress={onModelPillPress}
                activeOpacity={0.7}
                disabled={isLoading}
              >
                {modelPillContent}
              </TouchableOpacity>
            </GlassView>
          </View>

          <View style={styles.actionsGroup}>
            <GlassView isInteractive colorScheme={glassScheme} style={styles.iconGlass}>
              <TouchableOpacity
                testID="new-chat-button"
                style={styles.iconGlassInner}
                onPress={onNewChat}
                hitSlop={10}
                disabled={isGenerating}
              >
                <Ionicons name="add" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </GlassView>

            <GlassView isInteractive colorScheme={glassScheme} style={styles.iconGlass}>
              <TouchableOpacity
                style={[
                  styles.iconGlassInner,
                  incognitoActive && styles.iconButtonActive,
                ]}
                onPress={onStartIncognitoChat}
                hitSlop={10}
                disabled={isGenerating}
              >
                <MaterialCommunityIcons
                  name="ghost-outline"
                  size={20}
                  color={incognitoActive ? colors.accent : colors.textSecondary}
                />
              </TouchableOpacity>
            </GlassView>
          </View>
        </View>
      </View>
    ) : (
      <View style={[styles.glassHeader, styles.glassHeaderSolid, { paddingTop: topInset }]}>
        <View style={styles.modelBar}>
          <View style={styles.sideSlot}>
            <TouchableOpacity style={styles.menuButton} onPress={onMenuPress} hitSlop={10}>
              <MaterialCommunityIcons name="menu" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <View ref={modelPillRef} style={styles.modelBarCenter}>
            <TouchableOpacity
              testID="model-picker"
              style={[styles.modelPill, styles.modelPillSolid]}
              onPress={onModelPillPress}
              activeOpacity={0.7}
              disabled={isLoading}
            >
              {modelPillContent}
            </TouchableOpacity>
          </View>

          <View style={styles.actionsGroup}>
            <TouchableOpacity
              testID="new-chat-button"
              style={styles.newChatBtn}
              onPress={onNewChat}
              hitSlop={10}
              disabled={isGenerating}
            >
              <Ionicons name="add" size={24} color={colors.textSecondary} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.newChatBtn, incognitoActive && styles.iconButtonActive]}
              onPress={onStartIncognitoChat}
              hitSlop={10}
              disabled={isGenerating}
            >
              <MaterialCommunityIcons
                name="ghost-outline"
                size={20}
                color={incognitoActive ? colors.accent : colors.textSecondary}
              />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    )
  );
}

export const ChatHeader = memo(ChatHeaderComponent);

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    glassHeader: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      zIndex: 10,
      backgroundColor: colors.base,
    },
    glassHeaderSolid: {
      backgroundColor: colors.base,
    },
    modelBar: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: SPACING.lg,
      paddingVertical: SPACING.md,
    },
    sideSlot: {
      width: 80,
      alignItems: 'flex-start',
      justifyContent: 'center',
    },
    menuButton: {
      width: 36,
      height: 36,
      alignItems: 'center',
      justifyContent: 'center',
    },
    iconGlass: {
      width: 36,
      height: 36,
      borderRadius: 18,
      overflow: 'hidden',
    },
    iconGlassInner: {
      width: 36,
      height: 36,
      alignItems: 'center',
      justifyContent: 'center',
    },
    iconButtonActive: {
      backgroundColor: colors.accentTint,
      borderRadius: 18,
    },
    modelBarCenter: {
      flex: 1,
      alignItems: 'center',
    },
    actionsGroup: {
      width: 80,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: SPACING.sm,
    },
    modelPillGlass: {
      borderRadius: RADII.full,
      overflow: 'hidden',
      maxWidth: 220,
    },
    modelPill: {
      flexDirection: 'row',
      alignItems: 'center',
      borderRadius: RADII.full,
      paddingHorizontal: SPACING.md,
      paddingVertical: 7,
      maxWidth: 220,
    },
    modelPillSolid: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    loadedDot: {
      width: 7,
      height: 7,
      borderRadius: 4,
      backgroundColor: colors.accent,
      marginRight: 7,
      flexShrink: 0,
    },
    modelPillText: {
      fontSize: 14,
      color: colors.textPrimary,
      fontWeight: FONT.medium,
    },
    modelPillHint: {
      fontSize: 14,
      color: colors.textTertiary,
    },
    newChatBtn: {
      width: 36,
      height: 36,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
}
