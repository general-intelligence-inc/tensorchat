export const DARK_COLORS = {
  // Backgrounds
  base: '#212121',
  sidebar: '#171717',
  surface: '#2F2F2F',
  surfaceHover: '#383838',

  // Borders
  border: '#383838',
  borderSubtle: '#2A2A2A',

  // Accent
  accent: '#10A37F',
  accentDim: '#0D8A6B',

  // Text
  textPrimary: '#ECECEC',
  textSecondary: '#8E8EA0',
  textTertiary: '#5A5A6E',

  // Semantic
  destructive: '#EF4444',

  // Tab bar
  tabInactive: '#6B6B80',

  // Component-specific tokens
  userBubble: '#2A2A2A',
  errorBarBg: '#2A1414',
  errorBarBorder: '#4A1F1F',
  errorText: '#F87171',
  overlayBg: 'rgba(0,0,0,0.6)',
  accentTint: 'rgba(16,163,127,0.12)',
} as const;

export type ColorPalette = { [K in keyof typeof DARK_COLORS]: string };

export const LIGHT_COLORS: ColorPalette = {
  // Backgrounds
  base: '#FFFFFF',
  sidebar: '#F5F5F5',
  surface: '#EFEFEF',
  surfaceHover: '#E5E5E5',

  // Borders
  border: '#E0E0E0',
  borderSubtle: '#EBEBEB',

  // Accent (same in both modes)
  accent: '#10A37F',
  accentDim: '#0D8A6B',

  // Text
  textPrimary: '#111111',
  textSecondary: '#55556A',
  textTertiary: '#9999AA',

  // Semantic (same in both modes)
  destructive: '#EF4444',

  // Tab bar
  tabInactive: '#9999AA',

  // Component-specific tokens
  userBubble: '#E8E8E8',
  errorBarBg: '#FFF2F2',
  errorBarBorder: '#FECACA',
  errorText: '#DC2626',
  overlayBg: 'rgba(0,0,0,0.45)',
  accentTint: 'rgba(16,163,127,0.12)',
};

export function getColors(scheme: 'light' | 'dark'): ColorPalette {
  return scheme === 'dark' ? DARK_COLORS : LIGHT_COLORS;
}

export const RADII = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 24,
  full: 9999,
} as const;

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const FONT = {
  regular: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,
};
