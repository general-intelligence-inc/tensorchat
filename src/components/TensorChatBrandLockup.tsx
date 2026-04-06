import React from 'react';
import {
  Image,
  StyleProp,
  StyleSheet,
  Text,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { FONT, SPACING } from '../constants/theme';

export const TENSORCHAT_BRAND_SUBTITLE = 'Private AI. Intelligence on your terms.';
export const TENSORCHAT_BRAND_HEADER_OFFSET = 56;
export const TENSORCHAT_BRAND_STATUS_SLOT_HEIGHT = 20;
export const TENSORCHAT_BRAND_COMPOSER_OFFSET = 112;
export const TENSORCHAT_BRAND_MODEL_CATALOG_BANNER_OFFSET = 72;
export const TENSORCHAT_BRAND_STATUS_TOP_MARGIN = SPACING.xl + SPACING.xs;

interface TensorChatBrandLockupProps {
  scheme: 'light' | 'dark';
  titleColor: string;
  subtitleColor: string;
  logoVariant?: 'brand' | 'ghost';
  logoColor?: string;
  logoBackgroundColor?: string;
  subtitle?: string;
  subtitleVisibleCount?: number;
  containerStyle?: StyleProp<ViewStyle>;
  titleStyle?: StyleProp<TextStyle>;
  subtitleStyle?: StyleProp<TextStyle>;
}

interface TensorChatBrandStatusRowProps {
  text: string;
  textColor: string;
  hidden?: boolean;
  children: React.ReactNode;
}

export function TensorChatBrandLockup({
  scheme,
  titleColor,
  subtitleColor,
  logoVariant = 'brand',
  logoColor,
  logoBackgroundColor,
  subtitle = TENSORCHAT_BRAND_SUBTITLE,
  subtitleVisibleCount,
  containerStyle,
  titleStyle,
  subtitleStyle,
}: TensorChatBrandLockupProps): React.JSX.Element {
  const shouldRevealSubtitle = typeof subtitleVisibleCount === 'number';
  const visibleCount = shouldRevealSubtitle
    ? Math.max(0, Math.min(subtitleVisibleCount, subtitle.length))
    : subtitle.length;

  return (
    <View style={[styles.container, containerStyle]}>
      {logoVariant === 'ghost' ? (
        <View
          style={[
            styles.ghostLogo,
            logoBackgroundColor ? { backgroundColor: logoBackgroundColor } : null,
          ]}
        >
          <MaterialCommunityIcons
            name="ghost-outline"
            size={54}
            color={logoColor ?? titleColor}
          />
        </View>
      ) : (
        <Image
          source={
            scheme === 'light'
              ? require('../../assets/tc-light-t.png')
              : require('../../assets/tc-dark-t.png')
          }
          style={styles.logo}
          resizeMode="contain"
        />
      )}
      <Text style={[styles.title, { color: titleColor }, titleStyle]}>TensorChat</Text>
      <Text style={[styles.subtitle, { color: subtitleColor }, subtitleStyle]}>
        {shouldRevealSubtitle
          ? Array.from(subtitle).map((character, index) => (
              <Text
                key={`${index}-${character}`}
                style={index < visibleCount ? null : styles.subtitleCharacterHidden}
              >
                {character}
              </Text>
            ))
          : subtitle}
      </Text>
    </View>
  );
}

export function TensorChatBrandStatusRow({
  text,
  textColor,
  hidden = false,
  children,
}: TensorChatBrandStatusRowProps): React.JSX.Element {
  return (
    <View style={styles.statusSlot}>
      <View
        style={[styles.statusRow, hidden ? styles.statusRowHidden : null]}
        accessibilityElementsHidden={hidden}
        importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
      >
        {children}
        <Text style={[styles.statusText, { color: textColor }]}>{text}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
  },
  logo: {
    width: 96,
    height: 96,
    borderRadius: 22,
    marginBottom: SPACING.xs,
  },
  ghostLogo: {
    width: 96,
    height: 96,
    borderRadius: 22,
    marginBottom: SPACING.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 26,
    fontWeight: FONT.semibold,
    letterSpacing: -0.3,
    textAlign: 'center',
    marginBottom: SPACING.sm,
  },
  subtitle: {
    maxWidth: 340,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  subtitleCharacterHidden: {
    opacity: 0,
  },
  statusSlot: {
    minHeight: TENSORCHAT_BRAND_STATUS_SLOT_HEIGHT,
    marginTop: TENSORCHAT_BRAND_STATUS_TOP_MARGIN,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  statusRowHidden: {
    opacity: 0,
  },
  statusText: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: FONT.medium,
  },
});