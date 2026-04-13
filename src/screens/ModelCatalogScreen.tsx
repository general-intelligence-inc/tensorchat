import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from "react";
import {
  Animated,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  PanResponder,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as FileSystem from "expo-file-system/legacy";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { ManagedAssetRow } from "../components/ManagedAssetRow";
import {
  ALL_MODELS,
  ChatBaseModel,
  CHAT_MODEL_FAMILIES,
  EMBEDDING_MODEL,
  TRANSLATION_MODELS,
  Quantization,
  ModelConfig,
  ModelCatalogTab,
  DEFAULT_MODEL_ID,
  getCatalogModelById,
  getChatModelsForBase,
  getModelById,
  getTranslationModelByPath,
  isLikelyCompleteModelFile,
  QUANTIZATION_DISPLAY_LABELS,
  getModelBrandBadge,
} from "../constants/models";
import { useLlamaContext } from "../context/LlamaContext";
import { useVoice } from "../hooks/useVoice";
import { useEmbeddingModelAsset } from "../hooks/useEmbeddingModelAsset";
import { ColorPalette, FONT, RADII, SPACING } from "../constants/theme";
import { useTheme } from "../context/ThemeContext";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import {
  SELECTED_MODEL_KEY,
  SELECTED_TRANSLATION_MODEL_KEY,
} from "../utils/loadableModels";
import { SELECTED_MINIAPP_MODEL_KEY } from "../miniapps/types";
import { getMiniAppContextSize } from "../agent/miniAppAgent";
import {
  clearModelDownloadState,
  downloadCatalogModelInBackground,
  downloadChatModelInBackground,
  getModelDownloadState,
  subscribeToModelDownloadState,
  type ModelDownloadState,
} from "../utils/modelDownloadManager";
import { SvgXml } from "react-native-svg";
import {
  getDeviceMemorySummary,
  getDeviceTotalMemoryBytes,
  getModelMemoryBlockReason,
  isModelAllowedByDeviceMemory,
} from "../utils/modelMemory";

const MODELS_DIR = FileSystem.documentDirectory + "models/";
const DELETE_WIDTH = 56;
const QUANT_SWIPE_WIDTH = 96; // two 36px buttons + gaps
type VoiceModelKind = "stt" | "tts";

function ModelBrandIcon({
  baseModel,
  size,
}: {
  baseModel: string;
  size: number;
}): React.JSX.Element {
  const badge = getModelBrandBadge(baseModel);
  if (badge.svg) {
    return (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size * 0.25,
          backgroundColor: badge.color + "18",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        <SvgXml xml={badge.svg} width={size * 0.65} height={size * 0.65} />
      </View>
    );
  }
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.25,
        backgroundColor: badge.color,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text
        style={{
          fontSize: size * 0.45,
          fontWeight: "700",
          color: "#FFFFFF",
        }}
      >
        {badge.letter}
      </Text>
    </View>
  );
}

const ADDON_OPTIONS: Array<{
  id: ModelCatalogTab;
  title: string;
  subtitle: string;
  badge: string;
}> = [
  {
    id: "voice",
    title: "Voice",
    subtitle: "TTS and STT",
    badge: "Add-on",
  },
  {
    id: "translation",
    title: "Translation",
    subtitle: "Dedicated text translation",
    badge: "Add-on",
  },
  {
    id: "embedding",
    title: "Embedding",
    subtitle: "File Vault retrieval",
    badge: "Add-on",
  },
];

const VOICE_MODELS: Array<{
  kind: VoiceModelKind;
  title: string;
  subtitle: string;
}> = [
  {
    kind: "stt",
    title: "Speech-to-Text (Whisper Tiny EN)",
    subtitle: "On-device transcription for voice input",
  },
  {
    kind: "tts",
    title: "Text-to-Speech (Piper Lessac)",
    subtitle: "On-device playback for assistant responses",
  },
];

interface DownloadProgress {
  modelId: string;
  progress: number; // 0-1
}

async function ensureModelsDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(MODELS_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(MODELS_DIR, { intermediates: true });
  }
}

function modelFilePath(filename: string): string {
  return MODELS_DIR + filename;
}

// Model files that have been replaced by newer variants and should be cleaned
// up automatically to free disk space.
const DEPRECATED_MODEL_FILENAMES = [
  "LFM2.5-1.2B-Thinking-Q8_0.gguf",
];

function formatManagedAssetSizeLabel(sizeGB: number): string {
  const fractionDigits = sizeGB >= 10 ? 1 : 2;
  return `~${sizeGB.toFixed(fractionDigits)} GB`;
}

interface QuantRowProps {
  model: ModelConfig | undefined;
  quantization: Quantization;
  isDownloaded: boolean;
  isLoaded: boolean;
  isLoadingThis: boolean;
  loadDisabled: boolean;
  downloadDisabled: boolean;
  disabledReason: string | null;
  downloadProgress: number | null; // pre-weighted 0..1 across model+mmproj
  onDownload: (model: ModelConfig) => void;
  onLoad: () => void;
  onDelete: () => void;
}

function QuantRow({
  model,
  quantization,
  isDownloaded,
  isLoaded,
  isLoadingThis,
  loadDisabled,
  downloadDisabled,
  disabledReason,
  downloadProgress,
  onDownload,
  onLoad,
  onDelete,
}: QuantRowProps): React.JSX.Element {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const fillWidth = useRef(new Animated.Value(0)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const isDownloadedRef = useRef(isDownloaded);
  const [rowWidth, setRowWidth] = useState(0);
  const isDownloading = downloadProgress !== null;

  useEffect(() => {
    isDownloadedRef.current = isDownloaded;
  }, [isDownloaded]);

  // Reset swipe when model is deleted
  useEffect(() => {
    if (!isDownloaded) {
      Animated.spring(translateX, {
        toValue: 0,
        useNativeDriver: true,
      }).start();
    }
  }, [isDownloaded, translateX]);

  // Set fill width directly from progress — callbacks arrive at a natural cadence.
  useEffect(() => {
    if (isDownloading && rowWidth > 0) {
      fillWidth.setValue((downloadProgress ?? 0) * rowWidth);
    } else {
      fillWidth.setValue(0);
    }
  }, [downloadProgress, rowWidth, fillWidth, isDownloading, isDownloaded]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: (_, g) =>
        isDownloadedRef.current &&
        Math.abs(g.dx) > 8 &&
        Math.abs(g.dx) > Math.abs(g.dy) * 2,
      onMoveShouldSetPanResponderCapture: (_, g) =>
        isDownloadedRef.current &&
        Math.abs(g.dx) > 8 &&
        Math.abs(g.dx) > Math.abs(g.dy) * 2,
      onPanResponderMove: (_, g) => {
        const x = Math.max(-QUANT_SWIPE_WIDTH, Math.min(0, g.dx));
        translateX.setValue(x);
      },
      onPanResponderRelease: (_, g) => {
        if (g.dx < -QUANT_SWIPE_WIDTH / 2) {
          Animated.spring(translateX, {
            toValue: -QUANT_SWIPE_WIDTH,
            useNativeDriver: true,
          }).start();
        } else {
          Animated.spring(translateX, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
        }
      },
      onPanResponderTerminationRequest: () => false,
      onPanResponderTerminate: () => {
        Animated.spring(translateX, {
          toValue: 0,
          useNativeDriver: true,
        }).start();
      },
    }),
  ).current;

  return (
    <View style={styles.quantSwipeContainer}>
      {isDownloaded && (
        <View style={styles.quantActionButtons}>
          {isLiquidGlassAvailable() ? (
            <GlassView isInteractive style={styles.quantActionGlass}>
              <TouchableOpacity
                style={[
                  styles.quantActionInner,
                  loadDisabled ? styles.buttonDisabled : null,
                ]}
                onPress={onLoad}
                disabled={loadDisabled}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={loadDisabled ? "lock-closed-outline" : "refresh"}
                  size={16}
                  color={loadDisabled ? colors.textTertiary : colors.accent}
                />
              </TouchableOpacity>
            </GlassView>
          ) : (
            <TouchableOpacity
              style={[
                styles.quantReloadAction,
                loadDisabled ? styles.buttonDisabled : null,
              ]}
              onPress={onLoad}
              disabled={loadDisabled}
              activeOpacity={0.7}
            >
              <Ionicons
                name={loadDisabled ? "lock-closed-outline" : "refresh"}
                size={16}
                color={loadDisabled ? colors.textTertiary : colors.accent}
              />
            </TouchableOpacity>
          )}
          {isLiquidGlassAvailable() ? (
            <GlassView isInteractive style={styles.quantActionGlass}>
              <TouchableOpacity
                style={styles.quantActionInner}
                onPress={onDelete}
                activeOpacity={0.7}
              >
                <Ionicons
                  name="trash-outline"
                  size={16}
                  color={colors.destructive}
                />
              </TouchableOpacity>
            </GlassView>
          ) : (
            <TouchableOpacity
              style={styles.quantDeleteAction}
              onPress={onDelete}
              activeOpacity={0.7}
            >
              <Ionicons name="trash-outline" size={16} color="#FFFFFF" />
            </TouchableOpacity>
          )}
        </View>
      )}
      <Animated.View
        style={[styles.quantSwipeRow, { transform: [{ translateX }] }]}
        {...panResponder.panHandlers}
      >
        <TouchableOpacity
          style={styles.quantRow}
          onPress={() => {
            Animated.spring(translateX, {
              toValue: 0,
              useNativeDriver: true,
            }).start();
          }}
          activeOpacity={0.7}
          onLayout={(e) => setRowWidth(e.nativeEvent.layout.width)}
        >
          {isDownloading && (
            <Animated.View
              style={[
                StyleSheet.absoluteFillObject,
                styles.quantFill,
                { width: fillWidth },
              ]}
              pointerEvents="none"
            />
          )}
          <View style={styles.quantLeft}>
            <View style={styles.quantLabelRow}>
              <Text style={styles.quantLabel}>
                {QUANTIZATION_DISPLAY_LABELS[quantization]}
              </Text>
              {model && (
                <Text style={styles.quantSizeBadge}>
                  ~{(model.sizeGB + (model.mmprojSizeGB ?? 0)).toFixed(2)} GB
                </Text>
              )}
              {model?.recommended && (
                <Text style={styles.recommendedBadge}>Recommended</Text>
              )}
              {model?.fast && <Text style={styles.fastBadge}>Fast</Text>}
            </View>
          </View>
          <View style={styles.quantRight}>
            {isDownloading ? (
              <Text style={styles.quantProgressText}>
                {Math.round((downloadProgress ?? 0) * 100)}%
              </Text>
            ) : isLoadingThis ? (
              <ActivityIndicator size="small" color={colors.accent} />
            ) : isLoaded ? (
              <Ionicons
                name="checkmark-circle"
                size={20}
                color={colors.accent}
              />
            ) : isDownloaded ? (
              <TouchableOpacity
                onPress={onLoad}
                hitSlop={12}
                style={[
                  styles.quantDownloadBtn,
                  loadDisabled ? styles.buttonDisabled : null,
                ]}
                disabled={loadDisabled}
              >
                <Ionicons
                  name={
                    loadDisabled ? "lock-closed-outline" : "play-circle-outline"
                  }
                  size={20}
                  color={loadDisabled ? colors.textTertiary : colors.accent}
                />
              </TouchableOpacity>
            ) : model ? (
              <TouchableOpacity
                onPress={() => onDownload(model)}
                hitSlop={12}
                style={[
                  styles.quantDownloadBtn,
                  downloadDisabled ? styles.buttonDisabled : null,
                ]}
                disabled={downloadDisabled}
              >
                <Ionicons
                  name={
                    downloadDisabled
                      ? "lock-closed-outline"
                      : "cloud-download-outline"
                  }
                  size={20}
                  color={colors.textTertiary}
                />
              </TouchableOpacity>
            ) : null}
          </View>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

interface DownloadedModelRowProps {
  model: ModelConfig;
  isLoaded: boolean;
  isLoadingThis: boolean;
  onLoad: () => void;
  onDelete: () => void;
}

function DownloadedModelRow({
  model,
  isLoaded,
  isLoadingThis,
  onLoad,
  onDelete,
}: DownloadedModelRowProps): React.JSX.Element {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const translateX = useRef(new Animated.Value(0)).current;

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > 6 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderMove: (_, g) => {
        const x = Math.max(-DELETE_WIDTH, Math.min(0, g.dx));
        translateX.setValue(x);
      },
      onPanResponderRelease: (_, g) => {
        if (g.dx < -DELETE_WIDTH / 2) {
          Animated.spring(translateX, {
            toValue: -DELETE_WIDTH,
            useNativeDriver: true,
          }).start();
        } else {
          Animated.spring(translateX, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(translateX, {
          toValue: 0,
          useNativeDriver: true,
        }).start();
      },
    }),
  ).current;

  return (
    <View style={styles.downloadedSwipeContainer}>
      <View style={styles.quantActionButtons}>
        {isLiquidGlassAvailable() ? (
          <GlassView isInteractive style={styles.quantActionGlass}>
            <TouchableOpacity
              style={styles.quantActionInner}
              onPress={onDelete}
              activeOpacity={0.8}
            >
              <Ionicons
                name="trash-outline"
                size={16}
                color={colors.destructive}
              />
            </TouchableOpacity>
          </GlassView>
        ) : (
          <TouchableOpacity
            style={styles.quantDeleteAction}
            onPress={onDelete}
            activeOpacity={0.8}
          >
            <Ionicons name="trash-outline" size={16} color="#FFFFFF" />
          </TouchableOpacity>
        )}
      </View>
      <Animated.View
        style={[styles.downloadedSwipeRow, { transform: [{ translateX }] }]}
        {...panResponder.panHandlers}
      >
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => {
            Animated.spring(translateX, {
              toValue: 0,
              useNativeDriver: true,
            }).start();
          }}
          style={styles.downloadedRow}
        >
          <View style={styles.downloadedInfo}>
            <Text style={styles.downloadedName}>{model.name}</Text>
          </View>
          {isLoaded ? (
            <Ionicons name="checkmark-circle" size={22} color={colors.accent} />
          ) : (
            <TouchableOpacity
              style={[
                styles.rowLoadButton,
                isLoadingThis && styles.buttonDisabled,
              ]}
              onPress={onLoad}
              disabled={isLoadingThis}
              activeOpacity={0.7}
            >
              {isLoadingThis ? (
                <ActivityIndicator size="small" color={colors.accent} />
              ) : (
                <Ionicons
                  name="play-circle-outline"
                  size={22}
                  color={colors.accent}
                />
              )}
            </TouchableOpacity>
          )}
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

function VoiceCombinedRow({
  isDownloaded,
  downloadProgress,
  isDownloading,
  isLoading,
  isLoaded,
  onDownload,
  onDelete,
  onReload,
}: {
  isDownloaded: boolean;
  downloadProgress: number | null;
  isDownloading: boolean;
  isLoading: boolean;
  isLoaded: boolean;
  onDownload: () => void;
  onDelete: () => void;
  onReload: () => void;
}): React.JSX.Element {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const fillWidth = useRef(new Animated.Value(0)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const isDownloadedRef = useRef(isDownloaded);
  const [rowWidth, setRowWidth] = useState(0);

  useEffect(() => {
    isDownloadedRef.current = isDownloaded;
  }, [isDownloaded]);

  useEffect(() => {
    if (!isDownloaded) {
      Animated.spring(translateX, {
        toValue: 0,
        useNativeDriver: true,
      }).start();
    }
  }, [isDownloaded, translateX]);

  useEffect(() => {
    if (isDownloading && rowWidth > 0) {
      Animated.timing(fillWidth, {
        toValue: (downloadProgress ?? 0) * rowWidth,
        duration: 80,
        useNativeDriver: false,
      }).start();
    } else {
      fillWidth.setValue(0);
    }
  }, [downloadProgress, rowWidth, fillWidth, isDownloading]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: (_, g) =>
        isDownloadedRef.current &&
        Math.abs(g.dx) > 8 &&
        Math.abs(g.dx) > Math.abs(g.dy) * 2,
      onMoveShouldSetPanResponderCapture: (_, g) =>
        isDownloadedRef.current &&
        Math.abs(g.dx) > 8 &&
        Math.abs(g.dx) > Math.abs(g.dy) * 2,
      onPanResponderMove: (_, g) => {
        const x = Math.max(-QUANT_SWIPE_WIDTH, Math.min(0, g.dx));
        translateX.setValue(x);
      },
      onPanResponderRelease: (_, g) => {
        if (g.dx < -QUANT_SWIPE_WIDTH / 2) {
          Animated.spring(translateX, {
            toValue: -QUANT_SWIPE_WIDTH,
            useNativeDriver: true,
          }).start();
        } else {
          Animated.spring(translateX, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
        }
      },
      onPanResponderTerminationRequest: () => false,
      onPanResponderTerminate: () => {
        Animated.spring(translateX, {
          toValue: 0,
          useNativeDriver: true,
        }).start();
      },
    }),
  ).current;

  return (
    <View style={styles.quantSwipeContainer}>
      {isDownloaded && (
        <View style={styles.quantActionButtons}>
          {isLiquidGlassAvailable() ? (
            <GlassView isInteractive style={styles.quantActionGlass}>
              <TouchableOpacity
                style={styles.quantActionInner}
                onPress={onReload}
                activeOpacity={0.7}
              >
                <Ionicons name="refresh" size={16} color={colors.accent} />
              </TouchableOpacity>
            </GlassView>
          ) : (
            <TouchableOpacity
              style={styles.quantReloadAction}
              onPress={onReload}
              activeOpacity={0.7}
            >
              <Ionicons name="refresh" size={16} color={colors.accent} />
            </TouchableOpacity>
          )}
          {isLiquidGlassAvailable() ? (
            <GlassView isInteractive style={styles.quantActionGlass}>
              <TouchableOpacity
                style={styles.quantActionInner}
                onPress={onDelete}
                activeOpacity={0.7}
              >
                <Ionicons
                  name="trash-outline"
                  size={16}
                  color={colors.destructive}
                />
              </TouchableOpacity>
            </GlassView>
          ) : (
            <TouchableOpacity
              style={styles.quantDeleteAction}
              onPress={onDelete}
              activeOpacity={0.7}
            >
              <Ionicons name="trash-outline" size={16} color="#FFFFFF" />
            </TouchableOpacity>
          )}
        </View>
      )}
      <Animated.View
        style={[styles.quantSwipeRow, { transform: [{ translateX }] }]}
        {...panResponder.panHandlers}
      >
        <TouchableOpacity
          style={styles.quantRow}
          onPress={() => {
            Animated.spring(translateX, {
              toValue: 0,
              useNativeDriver: true,
            }).start();
          }}
          activeOpacity={0.7}
          onLayout={(e) => setRowWidth(e.nativeEvent.layout.width)}
        >
          {isDownloading && (
            <Animated.View
              style={[
                StyleSheet.absoluteFillObject,
                styles.quantFill,
                { width: fillWidth },
              ]}
              pointerEvents="none"
            />
          )}
          <View style={styles.quantLeft}>
            <View style={styles.quantLabelRow}>
              <Text style={styles.quantLabel}>Whisper + Piper</Text>
              <Text style={styles.quantSizeBadge}>~140 MB</Text>
            </View>
            <Text style={styles.voiceSubtitle}>
              Speech-to-text · default text-to-speech
            </Text>
          </View>
          <View style={styles.quantRight}>
            {isDownloading ? (
              <Text style={styles.quantProgressText}>
                {Math.round((downloadProgress ?? 0) * 100)}%
              </Text>
            ) : isLoading ? (
              <ActivityIndicator size="small" color={colors.accent} />
            ) : isLoaded ? (
              <Ionicons
                name="checkmark-circle"
                size={20}
                color={colors.accent}
              />
            ) : isDownloaded ? (
              <Ionicons
                name="checkmark-circle"
                size={20}
                color={colors.textSecondary}
              />
            ) : (
              <TouchableOpacity
                onPress={onDownload}
                hitSlop={12}
                style={styles.quantDownloadBtn}
              >
                <Ionicons
                  name="cloud-download-outline"
                  size={20}
                  color={colors.textTertiary}
                />
              </TouchableOpacity>
            )}
          </View>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

export function ModelCatalogScreen({
  onClose,
  initialTab,
  onChatModelsChanged,
  onChatModeSelected,
  onTranslationModeSelected,
  onMiniAppModeSelected,
  purpose = "chat",
}: {
  onClose?: () => void;
  initialTab?: ModelCatalogTab;
  onChatModelsChanged?: () => void;
  onChatModeSelected?: () => void;
  onTranslationModeSelected?: () => void;
  onMiniAppModeSelected?: () => void;
  /**
   * Which purpose the catalog is being opened for. Affects which
   * `SELECTED_*_MODEL_KEY` is written when the user picks a chat model,
   * and whether `onMiniAppModeSelected` is fired.
   */
  purpose?: "chat" | "translation" | "miniapp";
}): React.JSX.Element {
  const { colors, scheme } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const glassScheme = scheme === "dark" ? "dark" : "light";
  const {
    loadModel,
    unloadModel,
    loadedModelPath,
    isLoading,
    isGenerating,
    loadTranslationModel,
    unloadTranslationModel,
    loadedTranslationModelPath,
    isTranslationLoading,
  } = useLlamaContext();
  const {
    isAvailable: voiceAvailable,
    isKokoroAvailable,
    progress: voiceProgress,
    error: voiceError,
    getVoiceModelStatus,
    downloadVoiceModelsOnly,
    deleteVoiceModels,
    downloadKokoroVoiceModelOnly,
    deleteKokoroVoiceModel,
    clearError: clearVoiceError,
  } = useVoice();
  const {
    isDownloaded: embeddingDownloaded,
    isBusy: isEmbeddingAssetBusy,
    downloadProgress: embeddingProgress,
    download: handleDownloadEmbeddingModel,
    requestDelete: handleDeleteEmbeddingModel,
  } = useEmbeddingModelAsset();

  const [selectedModelId, setSelectedModelId] =
    useState<string>(DEFAULT_MODEL_ID);
  const [downloadedModels, setDownloadedModels] = useState<Set<string>>(
    new Set(),
  );
  const [downloadedTranslationModels, setDownloadedTranslationModels] =
    useState<Set<string>>(new Set());
  const [downloadState, setDownloadState] = useState<ModelDownloadState>(
    getModelDownloadState,
  );
  const [selectedBase, setSelectedBase] = useState<ModelCatalogTab>(
    initialTab ?? "0.8B",
  );
  const [expandedFamily, setExpandedFamily] = useState<ChatBaseModel | null>(
    initialTab && !["voice", "translation", "embedding", "downloaded"].includes(initialTab)
      ? (initialTab as ChatBaseModel)
      : null,
  );
  const [selectedForDeletion, setSelectedForDeletion] = useState<Set<string>>(
    new Set(),
  );
  const [isScanning, setIsScanning] = useState(true);
  const [loadingModelId, setLoadingModelId] = useState<string | null>(null);
  const [voiceModelsState, setVoiceModelsState] = useState({
    sttDownloaded: false,
    ttsDownloaded: false,
    sttLoaded: false,
    ttsLoaded: false,
    piperDownloaded: false,
    piperLoaded: false,
    kokoroDownloaded: false,
    kokoroLoaded: false,
    activeTTSBackend: null as "piper" | "kokoro" | null,
  });
  const [isRefreshingVoiceModels, setIsRefreshingVoiceModels] = useState(false);
  const selectedChatModels =
    selectedBase === "embedding" ||
    selectedBase === "translation" ||
    selectedBase === "voice" ||
    selectedBase === "downloaded"
      ? []
      : getChatModelsForBase(selectedBase);
  const loadedTranslationModel = getTranslationModelByPath(
    loadedTranslationModelPath,
  );
  const deviceTotalMemoryBytes = getDeviceTotalMemoryBytes();
  const deviceMemorySummary = getDeviceMemorySummary(deviceTotalMemoryBytes);
  const downloadProgress: DownloadProgress | null =
    downloadState.status === "downloading"
      ? {
          modelId: downloadState.modelId,
          progress: downloadState.progress,
        }
      : null;

  // Scan for already-downloaded models
  const scanDownloaded = useCallback(async () => {
    setIsScanning(true);
    try {
      await ensureModelsDir();

      // Clean up deprecated model files (e.g. Thinking → Instruct swap).
      for (const filename of DEPRECATED_MODEL_FILENAMES) {
        const path = modelFilePath(filename);
        try {
          const info = await FileSystem.getInfoAsync(path);
          if (info.exists) {
            await FileSystem.deleteAsync(path, { idempotent: true });
            console.log(`[ModelCatalog] cleaned up deprecated model: ${filename}`);
          }
        } catch { /* ignore cleanup errors */ }
      }

      const downloaded = new Set<string>();
      for (const model of ALL_MODELS) {
        const path = modelFilePath(model.filename);
        const info = await FileSystem.getInfoAsync(path);
        const actualBytes = info.exists ? ((info as any).size ?? 0) : 0;
        if (!info.exists || !isLikelyCompleteModelFile(model, actualBytes))
          continue;
        // For vision models, also require mmproj to be present
        if (model.mmprojFilename) {
          const mmprojInfo = await FileSystem.getInfoAsync(
            modelFilePath(model.mmprojFilename),
          );
          if (!mmprojInfo.exists) continue;
        }
        downloaded.add(model.id);
      }
      setDownloadedModels(downloaded);
    } catch (err) {
      console.warn("Failed to scan models:", err);
    } finally {
      setIsScanning(false);
    }
  }, []);

  const refreshTranslationDownloaded = useCallback(async (): Promise<
    Set<string>
  > => {
    try {
      await ensureModelsDir();
      const downloaded = new Set<string>();

      for (const model of TRANSLATION_MODELS) {
        const info = await FileSystem.getInfoAsync(
          modelFilePath(model.filename),
        );
        const actualBytes = info.exists
          ? ((info as { size?: number }).size ?? 0)
          : 0;

        if (!info.exists || !isLikelyCompleteModelFile(model, actualBytes)) {
          continue;
        }

        downloaded.add(model.id);
      }

      setDownloadedTranslationModels(downloaded);
      return downloaded;
    } catch (err) {
      console.warn("Failed to scan translation models:", err);
      setDownloadedTranslationModels(new Set());
      return new Set();
    }
  }, []);

  // Load persisted selected model id
  useEffect(() => {
    async function init() {
      await scanDownloaded();
      await refreshTranslationDownloaded();
      const saved = await AsyncStorage.getItem(SELECTED_MODEL_KEY);
      if (saved) {
        setSelectedModelId(saved);
        const model = getModelById(saved);
        if (model && model.baseModel !== "embedding" && !initialTab) {
          setSelectedBase(model.baseModel);
        }
      }
    }
    init();
  }, [refreshTranslationDownloaded, scanDownloaded]);

  useEffect(() => {
    return subscribeToModelDownloadState(setDownloadState);
  }, []);

  useEffect(() => {
    if (downloadState.status === "completed") {
      const downloadedModel = getCatalogModelById(downloadState.modelId);

      if (downloadedModel?.catalogKind === "chat") {
        setDownloadedModels(
          (prev) => new Set([...prev, downloadState.modelId]),
        );
        onChatModelsChanged?.();
      }

      if (downloadedModel?.catalogKind === "translation") {
        void refreshTranslationDownloaded();
        onChatModelsChanged?.();
      }

      clearModelDownloadState();
      void scanDownloaded();

      if (downloadedModel) {
        Alert.alert(
          "Download complete",
          `${downloadedModel.name} is ready to use.`,
        );
      }

      return;
    }

    if (downloadState.status === "failed") {
      clearModelDownloadState();
      Alert.alert("Download failed", downloadState.message);
    }
  }, [
    downloadState,
    onChatModelsChanged,
    refreshTranslationDownloaded,
    scanDownloaded,
  ]);

  const downloadModel = useCallback(
    (modelToDownload: ModelConfig) => {
      if (downloadState.status === "downloading") {
        return;
      }

      const blockedReason = getModelMemoryBlockReason(
        modelToDownload,
        deviceTotalMemoryBytes,
      );
      if (blockedReason) {
        Alert.alert(
          "Not enough RAM",
          `${modelToDownload.name} cannot be downloaded on this device. ${blockedReason}`,
        );
        return;
      }

      void downloadChatModelInBackground(modelToDownload).catch(() => {});
    },
    [deviceTotalMemoryBytes, downloadState.status],
  );

  const deleteModel = useCallback(
    async (model: ModelConfig) => {
      const title = "Delete model";
      const message = `Delete ${model.name}? You will need to re-download it.`;

      Alert.alert(title, message, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              if (loadedModelPath?.endsWith(model.filename)) {
                await unloadModel();
              }
              await FileSystem.deleteAsync(modelFilePath(model.filename), {
                idempotent: true,
              });

              setDownloadedModels((prev) => {
                const next = new Set(prev);
                next.delete(model.id);
                return next;
              });
              onChatModelsChanged?.();
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              Alert.alert("Error", message);
            }
          },
        },
      ]);
    },
    [loadedModelPath, onChatModelsChanged, unloadModel],
  );

  const downloadTranslationModel = useCallback(
    (modelToDownload: ModelConfig) => {
      if (downloadState.status === "downloading") {
        return;
      }

      const blockedReason = getModelMemoryBlockReason(
        modelToDownload,
        deviceTotalMemoryBytes,
      );
      if (blockedReason) {
        Alert.alert(
          "Not enough RAM",
          `${modelToDownload.name} cannot be downloaded on this device. ${blockedReason}`,
        );
        return;
      }

      void downloadCatalogModelInBackground(modelToDownload).catch(() => {});
    },
    [deviceTotalMemoryBytes, downloadState.status],
  );

  const deleteTranslationModel = useCallback(
    (model: ModelConfig) => {
      Alert.alert(
        "Delete translation model",
        `Delete ${model.name}? You will need to re-download it.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: async () => {
              try {
                if (loadedTranslationModelPath?.endsWith(model.filename)) {
                  await unloadTranslationModel();
                }
                await FileSystem.deleteAsync(modelFilePath(model.filename), {
                  idempotent: true,
                });
                setDownloadedTranslationModels((prev) => {
                  const next = new Set(prev);
                  next.delete(model.id);
                  return next;
                });
                onChatModelsChanged?.();
              } catch (err) {
                const message =
                  err instanceof Error ? err.message : String(err);
                Alert.alert("Error", message);
              }
            },
          },
        ],
      );
    },
    [loadedTranslationModelPath, onChatModelsChanged, unloadTranslationModel],
  );

  const toggleSelectForDeletion = useCallback((modelId: string) => {
    setSelectedForDeletion((prev) => {
      const next = new Set(prev);
      if (next.has(modelId)) next.delete(modelId);
      else next.add(modelId);
      return next;
    });
  }, []);

  const activateTranslationMode = useCallback(
    async (model: ModelConfig) => {
      if (!downloadedTranslationModels.has(model.id)) {
        return;
      }

      if (loadedTranslationModelPath?.endsWith(model.filename)) {
        onTranslationModeSelected?.();
        onClose?.();
        return;
      }

      setLoadingModelId(model.id);

      try {
        await AsyncStorage.setItem(SELECTED_TRANSLATION_MODEL_KEY, model.id);
        const didLoad = await loadTranslationModel(
          modelFilePath(model.filename),
        );

        if (!didLoad) {
          return;
        }

        onTranslationModeSelected?.();
        onClose?.();
      } finally {
        setLoadingModelId(null);
      }
    },
    [
      loadTranslationModel,
      onClose,
      onTranslationModeSelected,
      downloadedTranslationModels,
      loadedTranslationModelPath,
    ],
  );

  const loadModelById = useCallback(
    async (model: ModelConfig) => {
      const blockedReason = getModelMemoryBlockReason(
        model,
        deviceTotalMemoryBytes,
      );
      if (blockedReason) {
        Alert.alert(
          "Not enough RAM",
          `${model.name} cannot be loaded on this device. ${blockedReason}`,
        );
        return;
      }

      setLoadingModelId(model.id);
      try {
        // Write to the storage key matching the purpose the catalog was
        // opened for. A user selecting a model "for mini apps" should not
        // clobber their main chat model preference.
        const targetKey =
          purpose === "miniapp"
            ? SELECTED_MINIAPP_MODEL_KEY
            : SELECTED_MODEL_KEY;
        await AsyncStorage.setItem(targetKey, model.id);
        setSelectedModelId(model.id);
        // In miniapp mode we intentionally skip loading the mmproj sidecar
        // (vision is disabled per the feature brief) and request a larger
        // context window. For chat mode, pass mmproj path if the file
        // exists on disk and use the default context size.
        let mmprojPath: string | undefined;
        if (purpose !== "miniapp" && model.mmprojFilename) {
          const mp = modelFilePath(model.mmprojFilename);
          const info = await FileSystem.getInfoAsync(mp);
          if (info.exists) mmprojPath = mp;
        }
        const loadOptions =
          purpose === "miniapp"
            ? {
                contextSize: getMiniAppContextSize(
                  model.sizeGB,
                  getDeviceTotalMemoryBytes(),
                ),
              }
            : undefined;
        const didLoad = await loadModel(
          modelFilePath(model.filename),
          mmprojPath,
          loadOptions,
        );
        if (!didLoad) {
          return;
        }

        if (purpose === "miniapp") {
          onMiniAppModeSelected?.();
        } else {
          onChatModeSelected?.();
        }
        onClose?.();
      } finally {
        setLoadingModelId(null);
      }
    },
    [
      deviceTotalMemoryBytes,
      loadModel,
      onChatModeSelected,
      onMiniAppModeSelected,
      onClose,
      purpose,
    ],
  );

  const refreshVoiceModels = useCallback(async () => {
    if (!voiceAvailable) return;

    setIsRefreshingVoiceModels(true);
    try {
      const status = await getVoiceModelStatus();
      setVoiceModelsState(status);
    } catch (err) {
      console.warn("[Voice] Failed to refresh voice model status:", err);
    } finally {
      setIsRefreshingVoiceModels(false);
    }
  }, [voiceAvailable, getVoiceModelStatus]);

  useEffect(() => {
    if (selectedBase !== "voice") return;
    refreshVoiceModels();
  }, [selectedBase, refreshVoiceModels]);

  const handleDeleteVoiceModels = useCallback(() => {
    Alert.alert(
      "Delete voice models",
      "Delete Whisper + Piper? You will need to re-download them.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteVoiceModels();
              await refreshVoiceModels();
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              Alert.alert("Error", message);
            }
          },
        },
      ],
    );
  }, [deleteVoiceModels, refreshVoiceModels]);

  const downloadAllVoiceModels = useCallback(async () => {
    if (!voiceAvailable) {
      Alert.alert(
        "Voice unavailable",
        "Voice runtime is not available in this build. Please run on iOS/Android with the required native modules.",
      );
      return;
    }

    clearVoiceError();

    try {
      await downloadVoiceModelsOnly();
      await refreshVoiceModels();
      Alert.alert("Download complete", "Whisper + Piper are ready to use.");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      Alert.alert("Voice download failed", message);
    }
  }, [
    voiceAvailable,
    clearVoiceError,
    downloadVoiceModelsOnly,
    refreshVoiceModels,
  ]);

  const handleDeleteKokoroVoiceModel = useCallback(() => {
    Alert.alert(
      "Delete Kokoro",
      "Delete the optional Kokoro voice pack? Piper will be used again for playback.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteKokoroVoiceModel();
              await refreshVoiceModels();
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              Alert.alert("Error", message);
            }
          },
        },
      ],
    );
  }, [deleteKokoroVoiceModel, refreshVoiceModels]);

  const downloadKokoroVoiceModel = useCallback(async () => {
    if (!isKokoroAvailable) {
      Alert.alert(
        "Kokoro unavailable",
        "Kokoro playback is unavailable in this build. Reinstall dependencies and rebuild the native app to include the Phonemis bridge.",
      );
      return;
    }

    clearVoiceError();

    try {
      await downloadKokoroVoiceModelOnly();
      await refreshVoiceModels();
      Alert.alert(
        "Download complete",
        "Kokoro is downloaded and will be used automatically for playback.",
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      Alert.alert("Kokoro download failed", message);
    }
  }, [
    clearVoiceError,
    downloadKokoroVoiceModelOnly,
    isKokoroAvailable,
    refreshVoiceModels,
  ]);

  const deleteSelectedModels = useCallback(() => {
    if (selectedForDeletion.size === 0) return;

    const count = selectedForDeletion.size;
    Alert.alert(
      `Delete ${count} model${count > 1 ? "s" : ""}`,
      "These models will be removed from your device. You can re-download them later.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            for (const modelId of selectedForDeletion) {
              const model =
                ALL_MODELS.find((m) => m.id === modelId) ??
                TRANSLATION_MODELS.find((m) => m.id === modelId);
              if (!model) continue;
              try {
                if (loadedModelPath?.endsWith(model.filename)) {
                  await unloadModel();
                }
                if (loadedTranslationModelPath?.endsWith(model.filename)) {
                  await unloadTranslationModel();
                }
                await FileSystem.deleteAsync(modelFilePath(model.filename), {
                  idempotent: true,
                });
                if (model.mmprojFilename) {
                  await FileSystem.deleteAsync(
                    modelFilePath(model.mmprojFilename),
                    { idempotent: true },
                  );
                }
              } catch {
                // continue deleting others
              }
            }

            setDownloadedModels((prev) => {
              const next = new Set(prev);
              for (const id of selectedForDeletion) next.delete(id);
              return next;
            });
            setDownloadedTranslationModels((prev) => {
              const next = new Set(prev);
              for (const id of selectedForDeletion) next.delete(id);
              return next;
            });

            if (selectedForDeletion.has("__voice_stt_tts__")) {
              try {
                await deleteVoiceModels();
                await refreshVoiceModels();
              } catch { /* ignore */ }
            }
            if (selectedForDeletion.has("__voice_kokoro__")) {
              try {
                await deleteKokoroVoiceModel();
                await refreshVoiceModels();
              } catch { /* ignore */ }
            }
            if (selectedForDeletion.has("__embedding__")) {
              try {
                await handleDeleteEmbeddingModel();
              } catch { /* ignore */ }
            }

            setSelectedForDeletion(new Set());
            onChatModelsChanged?.();
          },
        },
      ],
    );
  }, [
    selectedForDeletion,
    loadedModelPath,
    loadedTranslationModelPath,
    unloadModel,
    unloadTranslationModel,
    deleteVoiceModels,
    deleteKokoroVoiceModel,
    refreshVoiceModels,
    handleDeleteEmbeddingModel,
    onChatModelsChanged,
  ]);

  const activeVoiceDownloadKind =
    voiceProgress &&
    (voiceProgress.stage === "initializing" ||
      voiceProgress.stage === "downloading" ||
      voiceProgress.stage === "loading")
      ? voiceProgress.model
      : null;
  const isVoiceDownloading = activeVoiceDownloadKind !== null;
  const embeddingAssetDisabled =
    downloadProgress !== null ||
    (isEmbeddingAssetBusy && embeddingProgress === null);

  return (
    <SafeAreaView
      style={styles.safeArea}
      edges={["top", "left", "right", "bottom"]}
    >
      {/* Header */}
      <View style={styles.modalHeader}>
        {onClose ? (
          isLiquidGlassAvailable() ? (
            <GlassView
              isInteractive
              colorScheme={glassScheme}
              style={styles.headerGlassButton}
            >
              <TouchableOpacity
                onPress={onClose}
                hitSlop={10}
                style={styles.headerGlassInner}
                activeOpacity={0.8}
              >
                <Ionicons name="close" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </GlassView>
          ) : (
            <TouchableOpacity
              onPress={onClose}
              hitSlop={10}
              style={styles.headerButtonSolid}
              activeOpacity={0.8}
            >
              <Ionicons name="close" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          )
        ) : (
          <View style={styles.modalHeaderSpacer} />
        )}

        <View style={styles.modalHeaderCenter}>
          <Text style={styles.modalTitle}>Model Catalog</Text>
        </View>

        <View style={styles.modalHeaderSpacer} />
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {/* Model family selector */}
        {/* Model catalog cards */}
        {[
          ...CHAT_MODEL_FAMILIES.map((f) => ({
            id: f.baseModel as ModelCatalogTab,
            title: f.title,
            subtitle: f.subtitle,
            baseModel: f.baseModel as string,
            kind: "chat" as const,
          })),
          ...ADDON_OPTIONS.map((o) => ({
            id: o.id,
            title: o.title,
            subtitle: o.subtitle,
            baseModel: o.id as string,
            kind: "addon" as const,
          })),
          {
            id: "downloaded" as ModelCatalogTab,
            title: "Downloaded",
            subtitle: "Manage on-device models",
            baseModel: "downloaded",
            kind: "addon" as const,
          },
        ].map((item) => {
          const isChatFamily = item.kind === "chat";
          const isExpanded = isChatFamily
            ? expandedFamily === item.id
            : selectedBase === item.id;

          const iconElement = item.id === "downloaded" ? (
            <View style={styles.catalogIconWrap}>
              <Ionicons name="folder-outline" size={18} color={colors.textSecondary} />
            </View>
          ) : item.id === "voice" ? (
            <View style={styles.catalogIconWrap}>
              <Ionicons name="mic-outline" size={18} color={colors.textSecondary} />
            </View>
          ) : item.id === "translation" ? (
            <View style={styles.catalogIconWrap}>
              <Ionicons name="language-outline" size={18} color={colors.textSecondary} />
            </View>
          ) : item.id === "embedding" ? (
            <View style={styles.catalogIconWrap}>
              <Ionicons name="cube-outline" size={18} color={colors.textSecondary} />
            </View>
          ) : (
            <ModelBrandIcon baseModel={item.baseModel} size={28} />
          );

          return (
            <View key={item.id} style={styles.catalogCard}>
              <TouchableOpacity
                style={styles.catalogCardHeader}
                onPress={() => {
                  if (isChatFamily) {
                    const base = item.id as ChatBaseModel;
                    const next = expandedFamily === base ? null : base;
                    setExpandedFamily(next);
                    if (next) setSelectedBase(next);
                    else setSelectedBase("0.8B");
                  } else {
                    const wasActive = selectedBase === item.id;
                    setSelectedBase(wasActive ? "0.8B" : item.id);
                    setExpandedFamily(null);
                    if (item.id !== "downloaded")
                      setSelectedForDeletion(new Set());
                  }
                }}
                activeOpacity={0.7}
              >
                {iconElement}
                <Text
                  style={[
                    styles.catalogRowTitle,
                    isExpanded && styles.catalogRowTitleActive,
                  ]}
                  numberOfLines={1}
                >
                  {item.title}
                </Text>
                <Text style={styles.catalogRowSub} numberOfLines={1}>
                  {item.subtitle}
                </Text>
                <Ionicons
                  name={isExpanded ? "chevron-up" : "chevron-forward"}
                  size={16}
                  color={isExpanded ? colors.accent : colors.textTertiary}
                />
              </TouchableOpacity>

              {/* Inline expanded content for chat families */}
              {isChatFamily && isExpanded && (() => {
                const family = CHAT_MODEL_FAMILIES.find(
                  (f) => f.baseModel === item.id,
                );
                if (!family) return null;
                return (
                  <View style={styles.catalogCardBody}>
                    {family.models.map((model, idx) => {
                      const isDownloaded = downloadedModels.has(model.id);
                      const isLoaded = !!loadedModelPath?.endsWith(
                        model.filename,
                      );
                      const isLoadingThis = loadingModelId === model.id;
                      const modelBlockedReason = getModelMemoryBlockReason(
                        model,
                        deviceTotalMemoryBytes,
                      );
                      const isModelAllowed = isModelAllowedByDeviceMemory(
                        model,
                        deviceTotalMemoryBytes,
                      );
                      const progress =
                        downloadProgress?.modelId === model.id
                          ? downloadProgress.progress
                          : null;
                      return (
                        <React.Fragment key={model.id}>
                          {idx > 0 && (
                            <View style={styles.quantDivider} />
                          )}
                          <QuantRow
                            model={model}
                            quantization={model.quantization}
                            isDownloaded={isDownloaded}
                            isLoaded={isLoaded}
                            isLoadingThis={isLoadingThis}
                            loadDisabled={!isModelAllowed}
                            downloadDisabled={!isModelAllowed}
                            disabledReason={modelBlockedReason}
                            downloadProgress={progress}
                            onDownload={(m) => downloadModel(m)}
                            onLoad={() => {
                              if (model) loadModelById(model);
                            }}
                            onDelete={() => {
                              if (model) deleteModel(model);
                            }}
                          />
                        </React.Fragment>
                      );
                    })}
                  </View>
                );
              })()}
              {isChatFamily && isExpanded && deviceMemorySummary ? (
                <Text style={styles.deviceMemoryHint}>
                  {deviceMemorySummary}
                </Text>
              ) : null}

              {/* Inline expanded content for voice */}
              {item.id === "voice" && isExpanded && (
                <View style={styles.catalogCardBody}>
                  {(() => {
                    const STT_WEIGHT = 75 / 140;
                    const TTS_WEIGHT = 65 / 140;
                    const bothDownloaded =
                      voiceModelsState.sttDownloaded &&
                      voiceModelsState.piperDownloaded;
                    const bothLoaded =
                      voiceModelsState.sttLoaded && voiceModelsState.piperLoaded;
                    let combinedProgress: number | null = null;
                    if (
                      voiceProgress &&
                      voiceProgress.stage === "downloading" &&
                      voiceProgress.ttsBackend !== "kokoro"
                    ) {
                      if (voiceProgress.model === "stt") {
                        combinedProgress =
                          (voiceProgress.progress ?? 0) * STT_WEIGHT;
                      } else {
                        combinedProgress =
                          STT_WEIGHT +
                          (voiceProgress.progress ?? 0) * TTS_WEIGHT;
                      }
                    }
                    const isDownloading = combinedProgress !== null;
                    const isVoiceLoading =
                      voiceProgress?.stage === "loading" &&
                      voiceProgress.ttsBackend !== "kokoro";
                    const kokoroProgress =
                      voiceProgress?.ttsBackend === "kokoro" &&
                      (voiceProgress.stage === "downloading" ||
                        voiceProgress.stage === "loading")
                        ? voiceProgress.progress
                        : null;
                    return (
                      <>
                        <VoiceCombinedRow
                          isDownloaded={bothDownloaded}
                          downloadProgress={combinedProgress}
                          isDownloading={isDownloading}
                          isLoading={isVoiceLoading}
                          isLoaded={bothLoaded}
                          onDownload={downloadAllVoiceModels}
                          onDelete={handleDeleteVoiceModels}
                          onReload={downloadAllVoiceModels}
                        />
                        <View style={styles.quantDivider} />
                        <ManagedAssetRow
                          style={styles.quantSwipeContainer}
                          title="Kokoro"
                          subtitle={
                            !isKokoroAvailable
                              ? "Requires a rebuilt native app"
                              : voiceModelsState.activeTTSBackend === "kokoro"
                                ? "Currently preferred for playback"
                                : "More natural playback voice model"
                          }
                          sizeLabel="~87 MB"
                          isDownloaded={voiceModelsState.kokoroDownloaded}
                          downloadProgress={kokoroProgress}
                          disabled={
                            !isKokoroAvailable ||
                            (isVoiceDownloading &&
                              voiceProgress?.ttsBackend !== "kokoro")
                          }
                          onDownload={downloadKokoroVoiceModel}
                          onDelete={handleDeleteKokoroVoiceModel}
                        />
                      </>
                    );
                  })()}
                  {voiceError ? (
                    <Text style={styles.catalogCardHint}>
                      Voice error: {voiceError}
                    </Text>
                  ) : null}
                </View>
              )}

              {/* Inline expanded content for translation */}
              {item.id === "translation" && isExpanded && (
                <View style={styles.catalogCardBody}>
                  {TRANSLATION_MODELS.map((model, idx) => {
                    const translationBlockedReason = getModelMemoryBlockReason(
                      model,
                      deviceTotalMemoryBytes,
                    );
                    const isDownloaded = downloadedTranslationModels.has(
                      model.id,
                    );
                    const translationLoadDisabled =
                      isDownloaded && !!translationBlockedReason;
                    return (
                      <React.Fragment key={model.id}>
                        {idx > 0 && <View style={styles.quantDivider} />}
                        <ManagedAssetRow
                          style={styles.quantSwipeContainer}
                          title={model.name}
                          subtitle={model.description}
                          sizeLabel={formatManagedAssetSizeLabel(model.sizeGB)}
                          badge={
                            model.recommended
                              ? "Recommended"
                              : model.fast
                                ? "Fast"
                                : undefined
                          }
                          isDownloaded={isDownloaded}
                          isLoaded={loadedTranslationModel?.id === model.id}
                          isLoading={
                            loadingModelId === model.id ||
                            (isTranslationLoading &&
                              loadedTranslationModel?.id === model.id)
                          }
                          downloadProgress={
                            downloadProgress?.modelId === model.id
                              ? downloadProgress.progress
                              : null
                          }
                          disabled={
                            !isDownloaded &&
                            downloadState.status === "downloading" &&
                            downloadProgress?.modelId !== model.id
                          }
                          loadDisabled={translationLoadDisabled}
                          onDownload={() => downloadTranslationModel(model)}
                          onLoad={() => activateTranslationMode(model)}
                          onDelete={() => deleteTranslationModel(model)}
                        />
                      </React.Fragment>
                    );
                  })}
                </View>
              )}

              {/* Inline expanded content for embedding */}
              {item.id === "embedding" && isExpanded && (
                <View style={styles.catalogCardBody}>
                  <ManagedAssetRow
                    style={styles.quantSwipeContainer}
                    title={EMBEDDING_MODEL.name}
                    subtitle="Required for File Vault semantic retrieval"
                    sizeLabel={`~${Math.round(EMBEDDING_MODEL.sizeGB * 1024)} MB`}
                    isDownloaded={embeddingDownloaded}
                    downloadProgress={embeddingProgress}
                    disabled={embeddingAssetDisabled}
                    onDownload={handleDownloadEmbeddingModel}
                    onDelete={handleDeleteEmbeddingModel}
                  />
                </View>
              )}

              {/* Inline expanded content for downloaded */}
              {item.id === "downloaded" && isExpanded && (() => {
                const downloadedChatModels = ALL_MODELS.filter((m) =>
                  downloadedModels.has(m.id),
                );
                const downloadedTranslation = TRANSLATION_MODELS.filter((m) =>
                  downloadedTranslationModels.has(m.id),
                );
                const allDownloaded = [
                  ...downloadedChatModels,
                  ...downloadedTranslation,
                ];
                const hasWhisper = voiceModelsState.sttDownloaded;
                const hasPiper = voiceModelsState.piperDownloaded;
                const hasWhisperPiper = hasWhisper || hasPiper;
                const hasKokoro = voiceModelsState.kokoroDownloaded;
                const hasEmbedding = embeddingDownloaded;
                const voiceItems: Array<{ id: string; name: string; size: string }> = [];
                if (hasWhisperPiper)
                  voiceItems.push({
                    id: "__voice_stt_tts__",
                    name: "Whisper + Piper",
                    size: hasWhisper && hasPiper ? "~140 MB" : hasWhisper ? "~75 MB" : "~65 MB",
                  });
                if (hasKokoro)
                  voiceItems.push({ id: "__voice_kokoro__", name: "Kokoro", size: "~87 MB" });
                const allSelectableIds = [
                  ...allDownloaded.map((m) => m.id),
                  ...voiceItems.map((v) => v.id),
                  ...(hasEmbedding ? ["__embedding__"] : []),
                ];
                const allSelected =
                  allSelectableIds.length > 0 &&
                  allSelectableIds.every((id) => selectedForDeletion.has(id));
                return (
                  <View style={styles.catalogCardBody}>
                    {allSelectableIds.length === 0 ? (
                      <Text style={styles.downloadedEmptyHint}>
                        No models downloaded yet.
                      </Text>
                    ) : (
                      <>
                        {/* Select all / Delete bar */}
                        <View style={styles.downloadedTopBar}>
                          <TouchableOpacity
                            onPress={() => {
                              if (allSelected) {
                                setSelectedForDeletion(new Set());
                              } else {
                                setSelectedForDeletion(
                                  new Set(allSelectableIds),
                                );
                              }
                            }}
                            activeOpacity={0.7}
                          >
                            <Text style={styles.selectAllText}>
                              {allSelected ? "Deselect all" : "Select all"}
                            </Text>
                          </TouchableOpacity>
                        </View>
                        {/* Grouped model rows */}
                        {([
                          { label: "Models", items: downloadedChatModels },
                          { label: "Translation", items: downloadedTranslation },
                        ] as const).map((section) => {
                          if (section.items.length === 0) return null;
                          return (
                            <React.Fragment key={section.label}>
                              <Text style={styles.downloadedSectionLabel}>
                                {section.label}
                              </Text>
                              {section.items.map((model, idx) => {
                                const isSelected = selectedForDeletion.has(model.id);
                                const isLoaded =
                                  loadedModelPath?.endsWith(model.filename) ||
                                  loadedTranslationModelPath?.endsWith(
                                    model.filename,
                                  );
                                return (
                                  <React.Fragment key={model.id}>
                                    {idx > 0 && <View style={styles.quantDivider} />}
                                    <TouchableOpacity
                                      style={styles.downloadedItemRow}
                                      onPress={() =>
                                        toggleSelectForDeletion(model.id)
                                      }
                                      activeOpacity={0.7}
                                    >
                                      <Ionicons
                                        name={
                                          isSelected
                                            ? "checkmark-circle"
                                            : "ellipse-outline"
                                        }
                                        size={20}
                                        color={
                                          isSelected
                                            ? colors.destructive
                                            : colors.textTertiary
                                        }
                                      />
                                      <Text
                                        style={styles.quantLabel}
                                        numberOfLines={1}
                                      >
                                        {model.name}
                                      </Text>
                                      <Text style={styles.quantSizeBadge}>
                                        ~{model.sizeGB.toFixed(2)} GB
                                      </Text>
                                      <View style={{ flex: 1 }} />
                                      {isLoaded && (
                                        <Ionicons
                                          name="checkmark-circle"
                                          size={18}
                                          color={colors.accent}
                                        />
                                      )}
                                    </TouchableOpacity>
                                  </React.Fragment>
                                );
                              })}
                            </React.Fragment>
                          );
                        })}
                        {/* Voice section */}
                        {voiceItems.length > 0 && (
                          <>
                            <Text style={styles.downloadedSectionLabel}>
                              Voice
                            </Text>
                            {voiceItems.map((v, idx) => {
                              const isSelected = selectedForDeletion.has(v.id);
                              return (
                                <React.Fragment key={v.id}>
                                  {idx > 0 && <View style={styles.quantDivider} />}
                                  <TouchableOpacity
                                    style={styles.downloadedItemRow}
                                    onPress={() => toggleSelectForDeletion(v.id)}
                                    activeOpacity={0.7}
                                  >
                                    <Ionicons
                                      name={isSelected ? "checkmark-circle" : "ellipse-outline"}
                                      size={20}
                                      color={isSelected ? colors.destructive : colors.textTertiary}
                                    />
                                    <Text style={styles.quantLabel}>{v.name}</Text>
                                    <Text style={styles.quantSizeBadge}>{v.size}</Text>
                                  </TouchableOpacity>
                                </React.Fragment>
                              );
                            })}
                          </>
                        )}
                        {/* Embedding section */}
                        {hasEmbedding && (() => {
                          const isSelected = selectedForDeletion.has("__embedding__");
                          return (
                            <>
                              <Text style={styles.downloadedSectionLabel}>
                                Embedding
                              </Text>
                              <TouchableOpacity
                                style={styles.downloadedItemRow}
                                onPress={() => toggleSelectForDeletion("__embedding__")}
                                activeOpacity={0.7}
                              >
                                <Ionicons
                                  name={isSelected ? "checkmark-circle" : "ellipse-outline"}
                                  size={20}
                                  color={isSelected ? colors.destructive : colors.textTertiary}
                                />
                                <Text style={styles.quantLabel}>
                                  {EMBEDDING_MODEL.name}
                                </Text>
                                <Text style={styles.quantSizeBadge}>
                                  ~{Math.round(EMBEDDING_MODEL.sizeGB * 1024)} MB
                                </Text>
                              </TouchableOpacity>
                            </>
                          );
                        })()}
                        {selectedForDeletion.size > 0 && (
                          <>
                            <View style={styles.quantDivider} />
                            <TouchableOpacity
                              style={styles.deleteSelectedButtonWide}
                              onPress={deleteSelectedModels}
                              activeOpacity={0.8}
                            >
                              <Ionicons
                                name="trash-outline"
                                size={16}
                                color={colors.destructive}
                              />
                              <Text style={styles.deleteSelectedTextWide}>
                                Delete Selected ({selectedForDeletion.size})
                              </Text>
                            </TouchableOpacity>
                          </>
                        )}
                      </>
                    )}
                  </View>
                );
              })()}
            </View>
          );
        })}

      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: colors.base },
    scroll: { flex: 1 },
    content: { paddingBottom: 48 },

    modalHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: SPACING.lg,
      paddingVertical: SPACING.md,
    },
    modalHeaderCenter: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    modalHeaderSpacer: {
      width: 36,
      height: 36,
    },
    modalTitle: {
      fontSize: 18,
      fontWeight: FONT.semibold,
      color: colors.textPrimary,
    },
    headerGlassButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      overflow: "hidden",
    },
    headerGlassInner: {
      width: 36,
      height: 36,
      alignItems: "center",
      justifyContent: "center",
    },
    headerButtonSolid: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },

    privacyBanner: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.surface,
      margin: SPACING.lg,
      borderRadius: RADII.md,
      padding: SPACING.md,
      borderLeftWidth: 3,
      borderLeftColor: colors.accent,
    },
    privacyDot: {
      width: 8,
      height: 8,
      borderRadius: RADII.full,
      backgroundColor: colors.accent,
      marginRight: SPACING.sm + 2,
      flexShrink: 0,
    },
    privacyText: {
      flex: 1,
      fontSize: 13,
      color: colors.textSecondary,
      lineHeight: 19,
    },

    sectionTitle: {
      fontSize: 12,
      fontWeight: FONT.medium,
      color: colors.textSecondary,
      marginHorizontal: SPACING.lg,
      marginTop: SPACING.xl,
      marginBottom: SPACING.sm,
    },
    sectionHint: {
      fontSize: 12,
      color: colors.textTertiary,
      marginHorizontal: SPACING.lg,
      marginBottom: SPACING.sm,
    },
    sectionSubgroup: {
      marginTop: 0,
    },
    segmentRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      marginHorizontal: SPACING.lg,
      gap: SPACING.sm,
    },
    // Catalog cards
    catalogCard: {
      marginHorizontal: SPACING.lg,
      marginBottom: SPACING.sm,
      backgroundColor: colors.surface,
      borderRadius: RADII.md,
      overflow: "hidden",
    },
    catalogCardHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: SPACING.md,
      padding: SPACING.md,
    },
    catalogIconWrap: {
      width: 28,
      height: 28,
      borderRadius: 7,
      backgroundColor: colors.base,
      alignItems: "center",
      justifyContent: "center",
    },
    catalogRowTitle: {
      fontSize: 15,
      fontWeight: FONT.medium,
      color: colors.textPrimary,
    },
    catalogRowTitleActive: {
      color: colors.accent,
    },
    catalogRowSub: {
      flex: 1,
      fontSize: 13,
      color: colors.textTertiary,
      textAlign: "right",
    },
    catalogCardBody: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    quantDivider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
      marginHorizontal: SPACING.md,
    },
    catalogCardHint: {
      fontSize: 12,
      color: colors.textTertiary,
      paddingHorizontal: SPACING.lg,
      paddingVertical: SPACING.sm,
    },
    deviceMemoryHint: {
      fontSize: 12,
      color: colors.textTertiary,
      textAlign: "center",
      paddingVertical: SPACING.sm,
    },
    downloadedItemRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm + 2,
    },
    downloadedTopBar: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm,
    },
    downloadedEmptyHint: {
      fontSize: 13,
      color: colors.textTertiary,
      textAlign: "center",
      paddingVertical: SPACING.lg,
    },
    downloadedSectionLabel: {
      fontSize: 11,
      fontWeight: FONT.semibold,
      color: colors.textTertiary,
      textTransform: "uppercase",
      letterSpacing: 0.5,
      paddingHorizontal: SPACING.md,
      paddingTop: SPACING.md,
      paddingBottom: SPACING.xs,
    },

    segment: {
      flexBasis: "48%",
      backgroundColor: colors.surface,
      borderRadius: RADII.md,
      padding: SPACING.md,
      borderWidth: 1,
      borderColor: colors.border,
    },
    segmentActive: {
      borderColor: colors.accent,
    },
    segmentText: {
      fontSize: 14,
      fontWeight: FONT.semibold,
      color: colors.textPrimary,
    },
    segmentHeaderRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: SPACING.xs,
    },
    segmentTextActive: { color: colors.accent },
    segmentBadge: {
      paddingHorizontal: 6,
      paddingVertical: 1,
      borderRadius: RADII.full,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.borderSubtle,
      flexShrink: 0,
    },
    segmentBadgeActive: {
      borderColor: colors.accent,
      backgroundColor: colors.accentTint,
    },
    segmentBadgeText: {
      fontSize: 9,
      fontWeight: FONT.semibold,
      color: colors.textSecondary,
      lineHeight: 12,
      textTransform: "uppercase",
    },
    segmentBadgeTextActive: {
      color: colors.accent,
    },
    segmentSub: { fontSize: 12, color: colors.textTertiary, marginTop: 3 },
    segmentSubActive: { color: colors.textSecondary },

    quantSwipeContainer: {
      borderRadius: 0,
    },
    quantSwipeContainerOuter: {
      marginHorizontal: SPACING.lg,
      marginBottom: SPACING.sm,
      borderRadius: RADII.sm,
    },
    quantActionButtons: {
      position: "absolute",
      right: 8,
      top: 0,
      bottom: 0,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    quantReloadAction: {
      width: 36,
      height: 36,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.surface,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.accent,
    },
    quantDeleteAction: {
      width: 36,
      height: 36,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.destructive,
      borderRadius: 18,
    },
    quantActionGlass: {
      width: 36,
      height: 36,
      borderRadius: 18,
      overflow: "hidden",
    },
    quantActionInner: {
      flex: 1,
      width: 36,
      alignItems: "center",
      justifyContent: "center",
    },
    quantSwipeRow: {
      backgroundColor: colors.surface,
    },
    quantRow: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.surface,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm + 2,
      overflow: "hidden",
    },
    quantLeft: { flex: 1 },
    quantLabelRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    quantLabel: {
      fontSize: 14,
      fontWeight: FONT.semibold,
      color: colors.textPrimary,
    },
    quantLabelActive: { color: colors.accent },
    recommendedBadge: {
      fontSize: 11,
      color: colors.textSecondary,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: RADII.sm,
      paddingHorizontal: 5,
      paddingVertical: 1,
    },
    fastBadge: {
      fontSize: 11,
      color: colors.textSecondary,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: RADII.sm,
      paddingHorizontal: 5,
      paddingVertical: 1,
    },
    quantDesc: {
      fontSize: 12,
      color: colors.textTertiary,
      marginTop: 4,
      lineHeight: 16,
    },
    quantRight: { width: 40, alignItems: "center", justifyContent: "center" },
    quantSizeBadge: {
      fontSize: 11,
      color: colors.textTertiary,
      backgroundColor: colors.borderSubtle,
      borderRadius: RADII.sm,
      paddingHorizontal: 6,
      paddingVertical: 2,
      overflow: "hidden",
    },
    quantHelperRow: {
      marginHorizontal: SPACING.lg,
      marginTop: 4,
      marginBottom: SPACING.sm,
      alignItems: "center",
    },
    quantHelperBadge: {
      fontSize: 11,
      lineHeight: 15,
      color: colors.textTertiary,
      textAlign: "center",
      maxWidth: "88%",
    },
    quantFill: {
      backgroundColor: colors.accentTint,
    },
    quantProgressText: {
      fontSize: 12,
      fontWeight: FONT.semibold,
      color: colors.accent,
      minWidth: 32,
      textAlign: "right",
    },
    quantDownloadBtn: {},

    actionRow: {
      marginHorizontal: SPACING.lg,
      marginTop: SPACING.lg,
      gap: SPACING.sm,
    },
    button: {
      borderRadius: RADII.md,
      paddingVertical: 14,
      paddingHorizontal: SPACING.lg,
      alignItems: "center",
    },
    downloadButton: { backgroundColor: colors.accent },
    loadButton: { borderWidth: 1, borderColor: colors.accent },
    loadButtonText: { color: colors.accent },
    buttonDisabled: { opacity: 0.5 },
    buttonText: {
      fontSize: 15,
      fontWeight: FONT.semibold,
      color: colors.textPrimary,
    },
    progressRow: { flexDirection: "row", alignItems: "center" },

    downloadedSwipeContainer: {
      marginHorizontal: SPACING.lg,
      marginBottom: 3,
      borderRadius: RADII.sm,
      overflow: "hidden",
    },
    downloadedSwipeRow: {
      backgroundColor: colors.surface,
    },
    downloadedRow: {
      flexDirection: "row",
      alignItems: "center",
      padding: SPACING.md,
    },
    downloadedInfo: { flex: 1 },
    downloadedName: {
      fontSize: 14,
      fontWeight: FONT.medium,
      color: colors.textPrimary,
    },
    downloadedSize: { fontSize: 12, color: colors.textTertiary, marginTop: 2 },
    loadedBadge: {
      fontSize: 12,
      color: colors.accent,
      fontWeight: FONT.semibold,
    },
    rowLoadButton: {
      padding: SPACING.xs,
      alignItems: "center",
      justifyContent: "center",
    },
    rowLoadButtonText: {
      fontSize: 13,
      color: colors.accent,
      fontWeight: FONT.medium,
    },

    voiceRow: {
      marginHorizontal: SPACING.lg,
      marginBottom: SPACING.sm,
      backgroundColor: colors.surface,
      borderRadius: RADII.sm,
      padding: SPACING.md,
      flexDirection: "row",
      alignItems: "center",
    },
    voiceRowLeft: {
      flex: 1,
    },
    voiceTitleRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: SPACING.sm,
    },
    voiceTitle: {
      fontSize: 14,
      fontWeight: FONT.semibold,
      color: colors.textPrimary,
    },
    voiceSubtitle: {
      marginTop: 2,
      fontSize: 12,
      color: colors.textSecondary,
    },
    voiceLoadedBadge: {
      fontSize: 11,
      color: colors.accent,
      backgroundColor: colors.borderSubtle,
      borderRadius: RADII.sm,
      paddingHorizontal: 6,
      paddingVertical: 2,
      overflow: "hidden",
    },
    voiceRowRight: {
      width: 42,
      alignItems: "center",
      justifyContent: "center",
    },
    voiceActions: {
      marginHorizontal: SPACING.lg,
      marginTop: SPACING.sm,
      gap: SPACING.sm,
    },
    voiceRefreshButton: {
      flexDirection: "row",
      alignItems: "center",
      alignSelf: "flex-start",
      gap: SPACING.xs,
      paddingVertical: SPACING.xs,
      paddingHorizontal: SPACING.sm,
      borderRadius: RADII.sm,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    voiceRefreshText: {
      fontSize: 12,
      color: colors.textSecondary,
      fontWeight: FONT.medium,
    },
    voiceProgressMessage: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    voiceErrorText: {
      fontSize: 12,
      color: colors.destructive,
    },
    voiceUnavailableText: {
      fontSize: 12,
      color: colors.textTertiary,
    },

    scanningRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: SPACING.lg,
      marginTop: SPACING.lg,
    },
    scanningText: { fontSize: 13, color: colors.textSecondary },

    footer: {
      marginHorizontal: SPACING.lg,
      marginTop: SPACING.xl,
    },
    footerText: {
      fontSize: 12,
      color: colors.textTertiary,
      textAlign: "center",
      lineHeight: 18,
    },

    // Downloaded tab
    downloadedHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginHorizontal: SPACING.lg,
      marginTop: SPACING.xl,
      marginBottom: SPACING.sm,
    },
    selectAllText: {
      fontSize: 14,
      fontWeight: FONT.medium,
      color: colors.accent,
    },
    manageRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: SPACING.md,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.sm + 2,
    },
    manageRowInfo: {
      flex: 1,
      gap: 2,
    },
    manageRowName: {
      fontSize: 16,
      fontWeight: FONT.medium,
      color: colors.textPrimary,
    },
    manageRowMeta: {
      fontSize: 13,
      color: colors.textTertiary,
    },
    manageEmpty: {
      alignItems: "center",
      paddingVertical: SPACING.xxl,
      gap: SPACING.sm,
    },
    manageEmptyTitle: {
      fontSize: 16,
      fontWeight: FONT.semibold,
      color: colors.textPrimary,
    },
    manageEmptyText: {
      fontSize: 14,
      color: colors.textTertiary,
      textAlign: "center",
      paddingHorizontal: SPACING.xxl,
    },
    deleteSelectedButtonWide: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: SPACING.sm,
      paddingVertical: SPACING.md,
    },
    deleteSelectedTextWide: {
      fontSize: 14,
      fontWeight: FONT.semibold,
      color: colors.destructive,
    },
  });
}
