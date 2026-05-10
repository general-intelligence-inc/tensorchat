import React, { useMemo } from "react";
import {
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ColorPalette, FONT, RADII, SPACING } from "../constants/theme";
import { useTheme } from "../context/ThemeContext";
import type { ImageGenResult } from "../types/imageGen";
import { resolveImageGenPath } from "../utils/imageGenStorage";

interface ImageGenHomeProps {
  items: ImageGenResult[];
  onOpenItem: (item: ImageGenResult) => void;
  onNewGeneration: () => void;
  onDeleteItem?: (item: ImageGenResult) => void;
}

function formatRelative(timestampMs: number): string {
  const diffMs = Date.now() - timestampMs;
  if (diffMs < 60_000) return "just now";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const date = new Date(timestampMs);
  return date.toLocaleDateString();
}

export function ImageGenHome({
  items,
  onOpenItem,
  onNewGeneration,
  onDeleteItem,
}: ImageGenHomeProps): React.JSX.Element {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  if (items.length === 0) {
    return (
      <View style={styles.emptyWrap}>
        <Ionicons
          name="images-outline"
          size={48}
          color={colors.textTertiary}
        />
        <Text style={styles.emptyTitle}>No images yet</Text>
        <Text style={styles.emptyHint}>
          Tap below to generate your first image on this device.
        </Text>
        <TouchableOpacity
          style={styles.primaryButton}
          activeOpacity={0.8}
          onPress={onNewGeneration}
        >
          <Ionicons name="add" size={18} color={colors.base} />
          <Text style={styles.primaryButtonText}>New generation</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.gridContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.grid}>
          {items.map((item) => (
            <TouchableOpacity
              key={item.id}
              style={styles.card}
              activeOpacity={0.85}
              onPress={() => onOpenItem(item)}
              onLongPress={onDeleteItem ? () => onDeleteItem(item) : undefined}
            >
              <Image
                source={{ uri: `file://${resolveImageGenPath(item.imagePath)}` }}
                style={styles.thumb}
                resizeMode="cover"
              />
              <View style={styles.cardBody}>
                <Text style={styles.cardPrompt} numberOfLines={2}>
                  {item.prompt || "(no prompt)"}
                </Text>
                <Text style={styles.cardMeta} numberOfLines={1}>
                  {formatRelative(item.createdAt)}
                  {item.stub ? " · stub" : ""}
                </Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
      <TouchableOpacity
        style={styles.fab}
        activeOpacity={0.85}
        onPress={onNewGeneration}
      >
        <Ionicons name="add" size={24} color={colors.base} />
      </TouchableOpacity>
    </View>
  );
}

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    container: {
      flex: 1,
    },
    gridContent: {
      padding: SPACING.md,
      paddingBottom: 96,
    },
    grid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: SPACING.md,
    },
    card: {
      width: "47%",
      backgroundColor: colors.surface,
      borderRadius: RADII.lg,
      overflow: "hidden",
      borderWidth: 1,
      borderColor: colors.borderSubtle,
    },
    thumb: {
      width: "100%",
      aspectRatio: 1,
      backgroundColor: colors.surfaceHover,
    },
    cardBody: {
      padding: SPACING.sm,
    },
    cardPrompt: {
      color: colors.textPrimary,
      fontSize: 13,
      fontWeight: FONT.medium,
      marginBottom: 2,
    },
    cardMeta: {
      color: colors.textTertiary,
      fontSize: 11,
    },
    emptyWrap: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: SPACING.md,
      padding: SPACING.xl,
    },
    emptyTitle: {
      color: colors.textPrimary,
      fontSize: 18,
      fontWeight: FONT.semibold,
    },
    emptyHint: {
      color: colors.textSecondary,
      fontSize: 14,
      textAlign: "center",
      marginBottom: SPACING.md,
    },
    primaryButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: SPACING.xs,
      backgroundColor: colors.accent,
      paddingHorizontal: SPACING.lg,
      paddingVertical: SPACING.sm,
      borderRadius: RADII.pill,
    },
    primaryButtonText: {
      color: colors.base,
      fontSize: 14,
      fontWeight: FONT.semibold,
    },
    fab: {
      position: "absolute",
      right: SPACING.lg,
      bottom: SPACING.lg,
      width: 56,
      height: 56,
      borderRadius: 28,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.accent,
      shadowColor: "#000",
      shadowOpacity: 0.18,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 2 },
      elevation: 6,
    },
  });
}
