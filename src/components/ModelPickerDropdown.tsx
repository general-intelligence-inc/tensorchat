import React, { memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  FlatList,
  Keyboard,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { LlamaContext } from '../context/LlamaContext';
import {
  ALL_MODELS,
  MINIAPP_MODELS,
  TRANSLATION_MODELS,
  isLikelyCompleteModelFile,
  ModelConfig,
} from '../constants/models';
import { ColorPalette, FONT, RADII, SPACING } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import { getModelMemoryBlockReason, isModelAllowedByDeviceMemory } from '../utils/modelMemory';
import {
  SELECTED_MODEL_KEY,
  SELECTED_TRANSLATION_MODEL_KEY,
} from '../utils/loadableModels';
import { SELECTED_MINIAPP_MODEL_KEY } from '../miniapps/types';
import { getMiniAppContextSize } from '../agent/miniAppAgent';
import { getDeviceTotalMemoryBytes } from '../utils/modelMemory';

const MODELS_DIR = FileSystem.documentDirectory + 'models/';
const DROPDOWN_WIDTH = 252;

interface AnchorMetrics {
  top: number;
  left: number;
}

interface ModelPickerDropdownProps {
  visible: boolean;
  mode: 'chat' | 'translation' | 'miniapp';
  onClose: () => void;
  onOpenModelCatalog: () => void;
  anchorRef: React.RefObject<View | null>;
}

function ModelPickerDropdownComponent({
  visible,
  mode,
  onClose,
  onOpenModelCatalog,
  anchorRef,
}: ModelPickerDropdownProps): React.JSX.Element | null {
  const {
    loadModel,
    loadedModelPath,
    loadedTranslationModelPath,
    loadTranslationModel,
    isLoading,
    isTranslationLoading,
  } = useContext(LlamaContext);

  const [downloadedModels, setDownloadedModels] = useState<ModelConfig[]>([]);
  const [scanning, setScanning] = useState(false);
  const [loadingModelId, setLoadingModelId] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<AnchorMetrics | null>(null);
  const [rendered, setRendered] = useState(false);
  const pendingCatalogOpenRef = useRef(false);

  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-8)).current;

  const requestOpenCatalog = useCallback(() => {
    pendingCatalogOpenRef.current = true;
    Keyboard.dismiss();
    onClose();
  }, [onClose]);

  // Measure anchor position when opening
  useEffect(() => {
    if (visible) {
      pendingCatalogOpenRef.current = false;
      anchorRef.current?.measure((_x, _y, width, height, pageX, pageY) => {
        const screenWidth = Dimensions.get('window').width;
        const centerX = pageX + width / 2;
        const rawLeft = centerX - DROPDOWN_WIDTH / 2;
        const clampedLeft = Math.max(
          SPACING.lg,
          Math.min(rawLeft, screenWidth - DROPDOWN_WIDTH - SPACING.lg),
        );
        setAnchor({ top: pageY + height + 6, left: clampedLeft });
        setRendered(true);
        // Animate in after position is set (next frame)
        requestAnimationFrame(() => {
          Animated.parallel([
            Animated.timing(opacity, {
              toValue: 1,
              duration: 160,
              useNativeDriver: true,
            }),
            Animated.spring(translateY, {
              toValue: 0,
              damping: 22,
              stiffness: 280,
              useNativeDriver: true,
            }),
          ]).start();
        });
      });
    } else {
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 0,
          duration: 140,
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: -8,
          duration: 140,
          useNativeDriver: true,
        }),
      ]).start(() => {
        const shouldOpenCatalog = pendingCatalogOpenRef.current;
        pendingCatalogOpenRef.current = false;
        setRendered(false);
        setAnchor(null);
        opacity.setValue(0);
        translateY.setValue(-8);

        if (shouldOpenCatalog) {
          requestAnimationFrame(() => {
            onOpenModelCatalog();
          });
        }
      });
    }
  }, [visible, anchorRef, onOpenModelCatalog, opacity, translateY]);

  const availableModels = useMemo<ModelConfig[]>(
    () =>
      mode === 'translation'
        ? TRANSLATION_MODELS
        : mode === 'miniapp'
          ? MINIAPP_MODELS
          : ALL_MODELS,
    [mode],
  );

  const scanModels = useCallback(async (): Promise<ModelConfig[]> => {
    setScanning(true);
    try {
      const found: ModelConfig[] = [];
      for (const model of availableModels) {
        const path = MODELS_DIR + model.filename;
        const info = await FileSystem.getInfoAsync(path);
        const actualBytes = info.exists ? (info as any).size ?? 0 : 0;
        if (!info.exists || !isLikelyCompleteModelFile(model, actualBytes)) continue;
        if (model.mmprojFilename) {
          const mmprojInfo = await FileSystem.getInfoAsync(MODELS_DIR + model.mmprojFilename);
          if (!mmprojInfo.exists) continue;
        }
        found.push(model);
      }
      setDownloadedModels(found);
      return found;
    } finally {
      setScanning(false);
    }
  }, [availableModels]);

  useEffect(() => {
    if (visible) {
      scanModels().then((found) => {
        if (found.length === 0) {
          // Nothing to show — skip the dropdown and go straight to the catalog
          requestOpenCatalog();
        }
      });
    }
  }, [visible, requestOpenCatalog, scanModels]);

  const handleSelectModel = useCallback(
    async (model: ModelConfig) => {
      const isBusy = mode === 'translation' ? isTranslationLoading : isLoading;
      if (isBusy) {
        onClose();
        return;
      }

      const isTranslationModel = model.baseModel === 'translation';
      const alreadyLoaded = isTranslationModel
        ? loadedTranslationModelPath?.endsWith(model.filename)
        : loadedModelPath?.endsWith(model.filename);

      if (alreadyLoaded) {
        onClose();
        return;
      }

      const blockedReason = getModelMemoryBlockReason(model);
      if (blockedReason) {
        Alert.alert('Not enough RAM', `${model.name} cannot be loaded on this device. ${blockedReason}`);
        return;
      }

      setLoadingModelId(model.id);
      try {
        if (isTranslationModel) {
          await AsyncStorage.setItem(SELECTED_TRANSLATION_MODEL_KEY, model.id);
          await loadTranslationModel(MODELS_DIR + model.filename);
        } else {
          // Mode-aware selection persistence. Miniapp mode writes to its
          // own key and intentionally skips loading the mmproj sidecar so
          // the chat-slot context is text-only. It also requests a larger
          // context window to fit the system-prompt injection.
          const selectionKey =
            mode === 'miniapp' ? SELECTED_MINIAPP_MODEL_KEY : SELECTED_MODEL_KEY;
          await AsyncStorage.setItem(selectionKey, model.id);
          let mmprojPath: string | undefined;
          if (mode !== 'miniapp' && model.mmprojFilename) {
            const candidatePath = MODELS_DIR + model.mmprojFilename;
            const mmprojInfo = await FileSystem.getInfoAsync(candidatePath);
            if (mmprojInfo.exists) {
              mmprojPath = candidatePath;
            }
          }
          const loadOptions =
            mode === 'miniapp'
              ? {
                  contextSize: getMiniAppContextSize(
                    model.sizeGB,
                    getDeviceTotalMemoryBytes(),
                  ),
                  modelSizeGB: model.sizeGB,
                }
              : { modelSizeGB: model.sizeGB };
          await loadModel(
            MODELS_DIR + model.filename,
            mmprojPath,
            loadOptions,
          );
        }
      } finally {
        setLoadingModelId(null);
        onClose();
      }
    },
    [
      mode,
      isLoading,
      isTranslationLoading,
      loadModel,
      loadTranslationModel,
      loadedModelPath,
      loadedTranslationModelPath,
      onClose,
    ],
  );

  const handleOpenCatalog = useCallback(() => {
    requestOpenCatalog();
  }, [requestOpenCatalog]);

  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  if (!rendered || !anchor) return null;

  const isCurrentlyLoaded = (model: ModelConfig) =>
    model.baseModel === 'translation'
      ? !!loadedTranslationModelPath?.endsWith(model.filename)
      : !!loadedModelPath?.endsWith(model.filename);

  return (
    <Modal transparent animationType="none" visible statusBarTranslucent>
      {/* Full-screen invisible tap target to dismiss */}
      <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />

      {/* Dropdown panel */}
      <Animated.View
        style={[
          styles.panel,
          {
            top: anchor.top,
            left: anchor.left,
            opacity,
            transform: [{ translateY }],
          },
        ]}
        pointerEvents="box-none"
      >
        {scanning ? (
          <View style={styles.scanningRow}>
            <ActivityIndicator size="small" color={colors.textSecondary} />
            <Text style={styles.scanningText}>  Scanning…</Text>
          </View>
        ) : downloadedModels.length === 0 ? (
          <View style={styles.emptyRow}>
            <Text style={styles.emptyText}>
              {mode === 'translation'
                ? 'No translation models downloaded yet.'
                : mode === 'miniapp'
                  ? 'No mini-app models downloaded yet.'
                  : 'No chat models downloaded yet.'}
            </Text>
          </View>
        ) : (
          <FlatList
            data={downloadedModels}
            keyExtractor={(m) => m.id}
            scrollEnabled={false}
            renderItem={({ item }) => {
              const loaded = isCurrentlyLoaded(item);
              const loading = loadingModelId === item.id;
              const ramBlocked = !isModelAllowedByDeviceMemory(item);
              return (
                <TouchableOpacity
                  style={[styles.modelRow, ramBlocked ? styles.modelRowDisabled : null]}
                  onPress={() => handleSelectModel(item)}
                  activeOpacity={0.7}
                >
                  <View style={styles.modelRowLeft}>
                    <Text style={[styles.modelName, ramBlocked ? styles.modelNameDisabled : null]}>
                      {item.name}
                    </Text>
                  </View>
                  <View style={styles.modelRowRight}>
                    {loading ? (
                      <ActivityIndicator size="small" color={colors.accent} />
                    ) : ramBlocked ? (
                      <Ionicons name="lock-closed-outline" size={18} color={colors.textTertiary} />
                    ) : loaded ? (
                      <Ionicons name="checkmark-circle" size={18} color={colors.accent} />
                    ) : (
                      <Ionicons name="play-circle-outline" size={18} color={colors.textTertiary} />
                    )}
                  </View>
                </TouchableOpacity>
              );
            }}
          />
        )}

        <View style={styles.divider} />

        <TouchableOpacity
          style={styles.catalogRow}
          onPress={handleOpenCatalog}
          activeOpacity={0.7}
        >
          <Ionicons
            name="albums-outline"
            size={18}
            color={colors.textSecondary}
            style={{ marginRight: SPACING.sm + 2 }}
          />
          <Text style={styles.catalogText}>Model Catalog</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
        </TouchableOpacity>
      </Animated.View>
    </Modal>
  );
}

export const ModelPickerDropdown = memo(ModelPickerDropdownComponent);

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    panel: {
      position: 'absolute',
      width: DROPDOWN_WIDTH,
      backgroundColor: colors.sidebar,
      borderRadius: RADII.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      paddingVertical: SPACING.xs,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.5,
      shadowRadius: 16,
      elevation: 24,
      overflow: 'hidden',
    },
    scanningRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: SPACING.lg,
      paddingVertical: SPACING.md,
    },
    scanningText: {
      fontSize: 14,
      color: colors.textSecondary,
    },
    emptyRow: {
      paddingHorizontal: SPACING.lg,
      paddingVertical: SPACING.md,
    },
    emptyText: {
      fontSize: 14,
      color: colors.textSecondary,
    },
    modelRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: SPACING.lg,
      paddingVertical: 11,
    },
    modelRowDisabled: {
      opacity: 0.55,
    },
    modelRowLeft: {
      flex: 1,
      marginRight: SPACING.sm,
    },
    modelName: {
      fontSize: 14,
      fontWeight: FONT.medium,
      color: colors.textPrimary,
    },
    modelNameDisabled: {
      color: colors.textSecondary,
    },
    modelRowRight: {
      width: 20,
      alignItems: 'center',
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
      marginVertical: SPACING.xs,
    },
    catalogRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: SPACING.lg,
      paddingVertical: 11,
    },
    catalogText: {
      flex: 1,
      fontSize: 14,
      fontWeight: FONT.medium,
      color: colors.textSecondary,
    },
  });
}
