import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as ImageManipulator from "expo-image-manipulator";
import * as MediaLibrary from "expo-media-library";
import {
  IMAGE_GEN_MODELS,
  listModelAssetFiles,
  type ModelConfig,
} from "../constants/models";
import { ColorPalette, FONT, RADII, SPACING } from "../constants/theme";
import { useTheme } from "../context/ThemeContext";
import { useImageGenContext } from "../context/ImageGenContext";
import {
  deleteGalleryItem,
  loadGallery,
  resolveImageGenPath,
  subscribeToGallery,
} from "../utils/imageGenStorage";
import { subscribeToModelDownloadState } from "../utils/modelDownloadManager";
import type { ImageGenResult } from "../types/imageGen";
import { ImageGenHome } from "./ImageGenHome";
import RNFS from "react-native-fs";

interface ImageGenScreenProps {
  onClose: () => void;
  /** Called when the user opens model catalog from the empty/error state. */
  onOpenCatalog?: () => void;
}

type ViewMode = "home" | "compose" | "detail";

const MODELS_DIR = `${RNFS.DocumentDirectoryPath}/models`;

function modelFilePath(filename: string): string {
  return `${MODELS_DIR}/${filename}`;
}

async function listDownloaded(): Promise<ModelConfig[]> {
  const downloaded: ModelConfig[] = [];
  for (const model of IMAGE_GEN_MODELS) {
    const files = listModelAssetFiles(model);
    let allPresent = true;
    for (const file of files) {
      const exists = await RNFS.exists(modelFilePath(file.filename));
      if (!exists) {
        allPresent = false;
        break;
      }
    }
    if (allPresent) {
      downloaded.push(model);
    }
  }
  return downloaded;
}

export function ImageGenScreen({
  onClose,
  onOpenCatalog,
}: ImageGenScreenProps): React.JSX.Element {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const imageGen = useImageGenContext();

  const [mode, setMode] = useState<ViewMode>("home");
  const [gallery, setGallery] = useState<ImageGenResult[]>([]);
  const [downloadedModels, setDownloadedModels] = useState<ModelConfig[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<string>("");
  const [latestResult, setLatestResult] = useState<ImageGenResult | null>(null);
  const [detailItem, setDetailItem] = useState<ImageGenResult | null>(null);

  // Hydrate gallery and downloaded-models on mount, and refresh whenever
  // a model download completes (e.g., the user just downloaded SD 1.5
  // from the catalog modal stacked on top of this screen — when they
  // dismiss it, we want the new model to be visible immediately).
  useEffect(() => {
    void loadGallery().then(setGallery);
    void listDownloaded().then((models) => {
      setDownloadedModels(models);
      if (models.length > 0 && !selectedModelId) {
        setSelectedModelId(models[0].id);
      }
    });
    const unsubGallery = subscribeToGallery(setGallery);
    const unsubDownload = subscribeToModelDownloadState((state) => {
      if (state.status === "completed") {
        void listDownloaded().then((models) => {
          setDownloadedModels(models);
          if (models.length > 0 && !selectedModelId) {
            setSelectedModelId(models[0].id);
          }
        });
      }
    });
    return () => {
      unsubGallery();
      unsubDownload();
    };
  }, [selectedModelId]);

  const selectedModel = useMemo(
    () => downloadedModels.find((m) => m.id === selectedModelId) ?? null,
    [downloadedModels, selectedModelId],
  );

  // Auto-load the selected model when entering compose mode.
  useEffect(() => {
    if (mode !== "compose") return;
    if (!selectedModel) return;
    if (imageGen.loadedModelId === selectedModel.id) return;
    if (imageGen.isLoading) return;
    void imageGen.loadModel(selectedModel);
  }, [imageGen, mode, selectedModel]);

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) {
      Alert.alert("Prompt required", "Type something to generate.");
      return;
    }
    if (!selectedModel) {
      Alert.alert("Pick a model", "No image-gen model is selected.");
      return;
    }
    if (imageGen.loadedModelId !== selectedModel.id) {
      const ok = await imageGen.loadModel(selectedModel);
      if (!ok) return;
    }
    // SD 1.5 was trained at 512×512 — generating at that resolution gives
    // sharper, more coherent output than 768. ~20 DDIM steps with cfg 7.5
    // is the canonical recipe for vanilla (non-LCM) SD 1.5.
    const result = await imageGen.generate(prompt.trim(), {
      width: 512,
      height: 512,
      steps: 20,
      cfgScale: 7.5,
    });
    if (result) {
      setLatestResult(result);
    } else if (imageGen.error) {
      Alert.alert("Generation failed", imageGen.error);
    }
  }, [imageGen, prompt, selectedModel]);

  const handleDeleteItem = useCallback((item: ImageGenResult) => {
    Alert.alert(
      "Delete image",
      "Remove this generation from the gallery?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void deleteGalleryItem(item.id);
            if (latestResult?.id === item.id) {
              setLatestResult(null);
            }
            if (detailItem?.id === item.id) {
              setDetailItem(null);
              setMode("home");
            }
          },
        },
      ],
    );
  }, [detailItem, latestResult]);

  /**
   * Save a generated image to the user's photo library. Generated files
   * are 24-bit BMP on disk (see `bitmapWriter.ts`); PHPhotoLibrary on iOS
   * does not accept BMP, so we transcode to PNG via `expo-image-manipulator`
   * (UIImage decodes the BMP, we re-encode as PNG) before saving via
   * `MediaLibrary.saveToLibraryAsync`. Permission is requested lazily on
   * first save; an explicit denial shows guidance to enable it in Settings.
   */
  const handleSaveImage = useCallback(async (item: ImageGenResult) => {
    try {
      // 1. Permission. saveToLibraryAsync needs add-only access on iOS;
      //    requestPermissionsAsync(true) asks for the limited "add" scope
      //    when the OS supports it.
      const perm = await MediaLibrary.requestPermissionsAsync(true);
      if (perm.status !== "granted") {
        Alert.alert(
          "Photos permission needed",
          "Allow TensorChat to add to your photo library in Settings, then try again.",
        );
        return;
      }

      // 2. Transcode BMP -> PNG. iOS Photos library rejects BMP outright;
      //    the manipulator decodes via UIImage and re-encodes as PNG.
      const png = await ImageManipulator.manipulateAsync(
        `file://${resolveImageGenPath(item.imagePath)}`,
        [],
        { format: ImageManipulator.SaveFormat.PNG },
      );

      // 3. Save.
      await MediaLibrary.saveToLibraryAsync(png.uri);
      Alert.alert("Saved", "Image saved to Photos.");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      Alert.alert("Couldn't save image", message);
    }
  }, []);

  // ---------- Header ----------
  const headerTitle =
    mode === "home" ? "Image Gen" : mode === "detail" ? "Image" : "Generate";

  const renderHeader = () => (
    <View style={styles.header}>
      <TouchableOpacity
        onPress={mode === "home" ? onClose : () => setMode("home")}
        activeOpacity={0.8}
        style={styles.headerBtn}
      >
        <Ionicons
          name={mode === "home" ? "close" : "chevron-back"}
          size={20}
          color={colors.textSecondary}
        />
      </TouchableOpacity>
      <Text style={styles.headerTitle}>{headerTitle}</Text>
      <View style={styles.headerBtn} />
    </View>
  );

  // ---------- Unavailable banner ----------
  if (!imageGen.isAvailable) {
    return (
      <SafeAreaView style={styles.safeArea} edges={["top", "left", "right", "bottom"]}>
        {renderHeader()}
        <View style={styles.bannerWrap}>
          <Ionicons name="information-circle-outline" size={32} color={colors.textTertiary} />
          <Text style={styles.bannerTitle}>Image generation unavailable</Text>
          <Text style={styles.bannerHint}>
            ONNX Runtime isn't loaded in this build. Rebuild the native app
            after installing dependencies and try again.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // ---------- No models downloaded ----------
  if (downloadedModels.length === 0) {
    return (
      <SafeAreaView style={styles.safeArea} edges={["top", "left", "right", "bottom"]}>
        {renderHeader()}
        <View style={styles.bannerWrap}>
          <Ionicons name="cloud-download-outline" size={32} color={colors.textTertiary} />
          <Text style={styles.bannerTitle}>No image models yet</Text>
          <Text style={styles.bannerHint}>
            Download a diffusion model from the catalog to start generating.
          </Text>
          {onOpenCatalog ? (
            <TouchableOpacity style={styles.primaryButton} activeOpacity={0.85} onPress={onOpenCatalog}>
              <Ionicons name="folder-open-outline" size={18} color={colors.base} />
              <Text style={styles.primaryButtonText}>Open catalog</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </SafeAreaView>
    );
  }

  // ---------- Detail view (one image fullscreen-ish) ----------
  if (mode === "detail" && detailItem) {
    return (
      <SafeAreaView style={styles.safeArea} edges={["top", "left", "right", "bottom"]}>
        {renderHeader()}
        <ScrollView contentContainerStyle={styles.detailWrap}>
          <Image
            source={{ uri: `file://${resolveImageGenPath(detailItem.imagePath)}` }}
            style={styles.detailImage}
            resizeMode="contain"
          />
          <Text style={styles.detailPrompt}>{detailItem.prompt}</Text>
          <Text style={styles.detailMeta}>
            {detailItem.width}×{detailItem.height} · seed {detailItem.seed}
            {detailItem.stub ? " · stub" : ""}
          </Text>
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={styles.primaryButton}
              activeOpacity={0.85}
              onPress={() => handleSaveImage(detailItem)}
            >
              <Ionicons name="download-outline" size={18} color={colors.base} />
              <Text style={styles.primaryButtonText}>Save image</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.secondaryButton}
              activeOpacity={0.85}
              onPress={() => handleDeleteItem(detailItem)}
            >
              <Ionicons name="trash-outline" size={18} color={colors.destructive} />
              <Text style={[styles.secondaryButtonText, { color: colors.destructive }]}>Delete</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ---------- Compose ----------
  if (mode === "compose") {
    return (
      <SafeAreaView style={styles.safeArea} edges={["top", "left", "right", "bottom"]}>
        {renderHeader()}
        <ScrollView contentContainerStyle={styles.composeWrap}>
          {!imageGen.isEngineConfigured ? (
            <View style={styles.stubBanner}>
              <Ionicons name="information-circle-outline" size={16} color={colors.accent} />
              <Text style={styles.stubBannerText}>
                ONNX Runtime unavailable on this build — image generation
                cannot run.
              </Text>
            </View>
          ) : null}

          <Text style={styles.label}>Model</Text>
          <View style={styles.modelChipsRow}>
            {downloadedModels.map((m) => (
              <TouchableOpacity
                key={m.id}
                style={[
                  styles.modelChip,
                  selectedModelId === m.id ? styles.modelChipActive : null,
                ]}
                onPress={() => setSelectedModelId(m.id)}
                activeOpacity={0.85}
              >
                <Text
                  style={[
                    styles.modelChipText,
                    selectedModelId === m.id ? styles.modelChipTextActive : null,
                  ]}
                >
                  {m.name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Prompt</Text>
          <TextInput
            style={styles.promptInput}
            value={prompt}
            onChangeText={setPrompt}
            placeholder="A serene mountain lake at sunrise, oil painting…"
            placeholderTextColor={colors.textTertiary}
            multiline
            numberOfLines={4}
          />

          <TouchableOpacity
            style={[
              styles.generateButton,
              imageGen.isGenerating || imageGen.isLoading
                ? styles.generateButtonBusy
                : null,
            ]}
            onPress={imageGen.isGenerating ? () => imageGen.cancel() : handleGenerate}
            activeOpacity={0.85}
          >
            {imageGen.isGenerating ? (
              <>
                <ActivityIndicator size="small" color={colors.base} />
                <Text style={styles.generateButtonText}>
                  Generating
                  {imageGen.progress
                    ? ` ${Math.round(imageGen.progress.fraction * 100)}%`
                    : "…"}
                  {" — tap to cancel"}
                </Text>
              </>
            ) : imageGen.isLoading ? (
              <>
                <ActivityIndicator size="small" color={colors.base} />
                <Text style={styles.generateButtonText}>Loading model…</Text>
              </>
            ) : (
              <>
                <Ionicons name="sparkles-outline" size={18} color={colors.base} />
                <Text style={styles.generateButtonText}>Generate</Text>
              </>
            )}
          </TouchableOpacity>

          {imageGen.error ? (
            <Text style={styles.errorText}>{imageGen.error}</Text>
          ) : null}

          {latestResult ? (
            <View style={styles.resultWrap}>
              <Image
                source={{ uri: `file://${resolveImageGenPath(latestResult.imagePath)}` }}
                style={styles.resultImage}
                resizeMode="contain"
              />
              <View style={styles.actionRow}>
                <TouchableOpacity
                  style={styles.primaryButton}
                  activeOpacity={0.85}
                  onPress={() => handleSaveImage(latestResult)}
                >
                  <Ionicons name="download-outline" size={18} color={colors.base} />
                  <Text style={styles.primaryButtonText}>Save image</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.secondaryButton}
                  activeOpacity={0.85}
                  onPress={() => {
                    setLatestResult(null);
                    setPrompt("");
                  }}
                >
                  <Ionicons name="refresh-outline" size={18} color={colors.textSecondary} />
                  <Text style={styles.secondaryButtonText}>New</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ---------- Home (gallery) ----------
  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right", "bottom"]}>
      {renderHeader()}
      <ImageGenHome
        items={gallery}
        onOpenItem={(item) => {
          setDetailItem(item);
          setMode("detail");
        }}
        onNewGeneration={() => {
          setLatestResult(null);
          setMode("compose");
        }}
        onDeleteItem={handleDeleteItem}
      />
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
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.borderSubtle,
    },
    headerBtn: {
      width: 36,
      height: 36,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: RADII.full,
    },
    headerTitle: {
      color: colors.textPrimary,
      fontSize: 16,
      fontWeight: FONT.semibold,
    },
    bannerWrap: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: SPACING.sm,
      padding: SPACING.xl,
    },
    bannerTitle: {
      color: colors.textPrimary,
      fontSize: 18,
      fontWeight: FONT.semibold,
    },
    bannerHint: {
      color: colors.textSecondary,
      fontSize: 14,
      textAlign: "center",
      marginBottom: SPACING.md,
    },
    composeWrap: {
      padding: SPACING.lg,
      gap: SPACING.md,
    },
    stubBanner: {
      flexDirection: "row",
      alignItems: "center",
      gap: SPACING.xs,
      padding: SPACING.sm,
      borderRadius: RADII.md,
      backgroundColor: colors.accentTint,
    },
    stubBannerText: {
      color: colors.textSecondary,
      fontSize: 12,
      flex: 1,
    },
    label: {
      color: colors.textSecondary,
      fontSize: 12,
      fontWeight: FONT.medium,
      marginTop: SPACING.sm,
    },
    modelChipsRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: SPACING.xs,
    },
    modelChip: {
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.xs,
      borderRadius: RADII.pill,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    modelChipActive: {
      backgroundColor: colors.accentTint,
      borderColor: colors.accent,
    },
    modelChipText: {
      color: colors.textSecondary,
      fontSize: 13,
      fontWeight: FONT.medium,
    },
    modelChipTextActive: {
      color: colors.accent,
    },
    promptInput: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: RADII.md,
      padding: SPACING.md,
      color: colors.textPrimary,
      fontSize: 15,
      minHeight: 96,
      textAlignVertical: "top",
    },
    generateButton: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: SPACING.xs,
      backgroundColor: colors.accent,
      borderRadius: RADII.pill,
      paddingVertical: SPACING.md,
      marginTop: SPACING.sm,
    },
    generateButtonBusy: {
      backgroundColor: colors.accentDim,
    },
    generateButtonText: {
      color: colors.base,
      fontSize: 15,
      fontWeight: FONT.semibold,
    },
    errorText: {
      color: colors.errorText,
      fontSize: 13,
      marginTop: SPACING.xs,
    },
    resultWrap: {
      gap: SPACING.sm,
      marginTop: SPACING.md,
    },
    resultImage: {
      width: "100%",
      aspectRatio: 1,
      borderRadius: RADII.lg,
      backgroundColor: colors.surface,
    },
    actionRow: {
      flexDirection: "row",
      gap: SPACING.sm,
      flexWrap: "wrap",
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
    secondaryButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: SPACING.xs,
      backgroundColor: colors.surface,
      paddingHorizontal: SPACING.lg,
      paddingVertical: SPACING.sm,
      borderRadius: RADII.pill,
      borderWidth: 1,
      borderColor: colors.border,
    },
    secondaryButtonText: {
      color: colors.textSecondary,
      fontSize: 14,
      fontWeight: FONT.medium,
    },
    detailWrap: {
      padding: SPACING.lg,
      gap: SPACING.md,
    },
    detailImage: {
      width: "100%",
      aspectRatio: 1,
      borderRadius: RADII.lg,
      backgroundColor: colors.surface,
    },
    detailPrompt: {
      color: colors.textPrimary,
      fontSize: 15,
      fontWeight: FONT.medium,
    },
    detailMeta: {
      color: colors.textTertiary,
      fontSize: 12,
    },
  });
}
