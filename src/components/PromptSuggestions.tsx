import React, { useMemo } from 'react';
import { ScrollView, Text, TouchableOpacity, StyleSheet, View } from 'react-native';
import { ColorPalette, RADII, SPACING, FONT } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';

const SUGGESTIONS = [
  'Explain quantum computing in simple terms',
  'Write a Python function to sort a list',
  'What are the pros and cons of remote work?',
  'Give me 5 ideas for a mobile app',
  'How do I improve my writing skills?',
  'Summarize the key ideas of stoicism',
];

interface Props {
  onSelectPrompt: (prompt: string) => void;
}

export function PromptSuggestions({ onSelectPrompt }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.wrapper}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        keyboardShouldPersistTaps="handled"
      >
        {SUGGESTIONS.map((prompt) => (
          <TouchableOpacity
            key={prompt}
            style={styles.chip}
            onPress={() => onSelectPrompt(prompt)}
            activeOpacity={0.7}
          >
            <Text style={styles.chipText} numberOfLines={1}>
              {prompt}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    wrapper: {
      marginBottom: SPACING.sm,
    },
    row: {
      paddingHorizontal: 2,
      gap: SPACING.sm,
      flexDirection: 'row',
      alignItems: 'center',
    },
    chip: {
      backgroundColor: colors.surface,
      borderRadius: RADII.pill,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      maxWidth: 220,
    },
    chipText: {
      color: colors.textSecondary,
      fontSize: 13,
      fontWeight: FONT.medium,
    },
  });
}
