import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  StyleSheet,
  View,
} from 'react-native';
import { DARK_COLORS, LIGHT_COLORS, SPACING } from '../constants/theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  TensorChatBrandLockup,
  TENSORCHAT_BRAND_COMPOSER_OFFSET,
  TENSORCHAT_BRAND_HEADER_OFFSET,
  TENSORCHAT_BRAND_MODEL_CATALOG_BANNER_OFFSET,
  TENSORCHAT_BRAND_SUBTITLE,
  TensorChatBrandStatusRow,
} from './TensorChatBrandLockup';

export interface AppBootScreenPalette {
  background: string;
  title: string;
  subtitle: string;
  statusText: string;
  indicator: string;
}

export function getAppBootScreenPalette(
  scheme: 'light' | 'dark',
): AppBootScreenPalette {
  if (scheme === 'dark') {
    return {
      background: DARK_COLORS.base,
      title: DARK_COLORS.textPrimary,
      subtitle: '#B7B7C6',
      statusText: DARK_COLORS.textSecondary,
      indicator: DARK_COLORS.accent,
    };
  }

  return {
    background: LIGHT_COLORS.base,
    title: LIGHT_COLORS.textPrimary,
    subtitle: LIGHT_COLORS.textSecondary,
    statusText: LIGHT_COLORS.textSecondary,
    indicator: LIGHT_COLORS.accent,
  };
}

interface AppBootScreenProps {
  phase: 'prepare' | 'autoload';
  scheme: 'light' | 'dark';
  bottomAccessory: 'composer' | 'catalogBanner';
  onSubtitleTypingComplete?: () => void;
}

export function AppBootScreen({
  phase,
  scheme,
  bottomAccessory,
  onSubtitleTypingComplete,
}: AppBootScreenProps): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const palette = getAppBootScreenPalette(scheme);
  const bottomOffset =
    bottomAccessory === 'composer'
      ? TENSORCHAT_BRAND_COMPOSER_OFFSET
      : TENSORCHAT_BRAND_MODEL_CATALOG_BANNER_OFFSET;
  const statusLabel =
    phase === 'autoload'
      ? 'Loading your last model locally'
      : 'Preparing on-device runtime';

  const pulse = useRef(new Animated.Value(0)).current;
  const [subtitleVisibleCount, setSubtitleVisibleCount] = useState(0);

  useEffect(() => {
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 520,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 520,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.delay(180),
      ]),
    );

    pulseLoop.start();

    return () => {
      pulseLoop.stop();
      pulse.stopAnimation();
    };
  }, [pulse]);

  useEffect(() => {
    const subtitleLength = TENSORCHAT_BRAND_SUBTITLE.length;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    setSubtitleVisibleCount(0);

    const startDelayId = setTimeout(() => {
      intervalId = setInterval(() => {
        setSubtitleVisibleCount((current) => {
          const next = Math.min(current + 1, subtitleLength);

          if (next >= subtitleLength && intervalId) {
            clearInterval(intervalId);
            intervalId = null;
          }

          return next;
        });
      }, 26);
    }, 140);

    return () => {
      clearTimeout(startDelayId);
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, []);

  useEffect(() => {
    if (subtitleVisibleCount < TENSORCHAT_BRAND_SUBTITLE.length) {
      return;
    }

    onSubtitleTypingComplete?.();
  }, [onSubtitleTypingComplete, subtitleVisibleCount]);

  const pulseScale = pulse.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.92, 1.18, 0.92],
  });
  const pulseOpacity = pulse.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.58, 1, 0.58],
  });

  return (
    <View style={[styles.overlay, { backgroundColor: palette.background }]}>
      <View
        style={[
          styles.content,
          { paddingTop: insets.top + TENSORCHAT_BRAND_HEADER_OFFSET },
          { paddingBottom: insets.bottom + bottomOffset },
        ]}
      >
        <View style={styles.brandStage}>
          <TensorChatBrandLockup
            scheme={scheme}
            titleColor={palette.title}
            subtitleColor={palette.subtitle}
            subtitleVisibleCount={subtitleVisibleCount}
          />

          <TensorChatBrandStatusRow text={statusLabel} textColor={palette.statusText}>
            <Animated.View
              style={[
                styles.statusPulse,
                {
                  backgroundColor: palette.indicator,
                  opacity: pulseOpacity,
                  transform: [{ scale: pulseScale }],
                },
              ]}
            />
          </TensorChatBrandStatusRow>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.xxl,
  },
  brandStage: {
    alignItems: 'center',
  },
  statusPulse: {
    width: 8,
    height: 8,
    borderRadius: 999,
  },
});