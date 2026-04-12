import React, { useMemo } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { ColorPalette, SPACING } from "../constants/theme";
import { useTheme } from "../context/ThemeContext";
import {
  TensorChatBrandLockup,
  TENSORCHAT_BRAND_HEADER_OFFSET,
  TensorChatBrandStatusRow,
} from "./TensorChatBrandLockup";

interface ChatEmptyStateProps {
  topInset: number;
  mode?: "chat" | "translation" | "miniapp";
  isIncognito?: boolean;
  isModelReady?: boolean;
  isModelLoading?: boolean;
}

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    emptyState: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: SPACING.xxl,
      backgroundColor: colors.base,
    },
    brandStage: {
      alignItems: "center",
    },
    hiddenStatusPulse: {
      width: 8,
      height: 8,
      borderRadius: 999,
    },
  });
}

export function ChatEmptyState({
  topInset,
  mode = "chat",
  isIncognito = false,
  isModelReady = false,
  isModelLoading = false,
}: ChatEmptyStateProps): React.JSX.Element {
  const { colors, scheme } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={[
        styles.emptyState,
        { paddingTop: topInset + TENSORCHAT_BRAND_HEADER_OFFSET },
      ]}
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      scrollEnabled={false}
    >
      <View style={styles.brandStage}>
        <TensorChatBrandLockup
          scheme={scheme}
          titleColor={colors.textPrimary}
          subtitleColor={colors.textSecondary}
          logoVariant={isIncognito ? "ghost" : "brand"}
          logoColor={isIncognito ? colors.accent : undefined}
          subtitle={
            isIncognito
              ? "This session won't be saved."
              : undefined
          }
        />
        <TensorChatBrandStatusRow
          text={
            mode === "translation"
              ? isModelLoading
                ? "Loading translation model"
                : isModelReady
                  ? "Translation mode is ready on-device"
                  : "Choose a translation model to start translating"
              : mode === "miniapp"
                ? isModelLoading
                  ? "Loading Gemma 4 E2B for mini apps"
                  : isModelReady
                    ? "Describe a mini app you want to build"
                    : "Download Gemma 4 E2B to start building mini apps"
                : "Loading chat model"
          }
          textColor={colors.textSecondary}
          hidden
        >
          <View style={styles.hiddenStatusPulse} />
        </TensorChatBrandStatusRow>
      </View>
    </ScrollView>
  );
}
