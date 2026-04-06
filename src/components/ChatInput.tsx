import React, { memo, useMemo } from "react";
import {
  Animated,
  Platform,
  View,
  ScrollView,
  Text,
  Image,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { ColorPalette, FONT, RADII, SPACING } from "../constants/theme";
import { useTheme } from "../context/ThemeContext";
import type { RagSource } from "../types/fileRag";

// ─── Sound Waveform ──────────────────────────────────────────────────────────

const BAR_COUNT = 56;
const BAR_MIN_H = 3;
const BAR_MAX_H = 22;

function SoundWaveform({ active }: { active: boolean }): React.JSX.Element {
  const { colors } = useTheme();
  const waveStyles = useMemo(() => createWaveStyles(colors), [colors]);
  const barAnims = React.useRef<Animated.Value[]>(
    Array.from({ length: BAR_COUNT }, () => new Animated.Value(BAR_MIN_H)),
  ).current;
  const animRef = React.useRef<Animated.CompositeAnimation | null>(null);

  React.useEffect(() => {
    if (animRef.current) {
      animRef.current.stop();
      animRef.current = null;
    }

    if (active) {
      const loops = barAnims.map((anim) => {
        const dur = 180 + Math.floor(Math.random() * 320);
        const maxH = 8 + Math.floor(Math.random() * (BAR_MAX_H - 8));
        return Animated.loop(
          Animated.sequence([
            Animated.timing(anim, {
              toValue: maxH,
              duration: dur,
              useNativeDriver: false,
            }),
            Animated.timing(anim, {
              toValue: BAR_MIN_H,
              duration: dur,
              useNativeDriver: false,
            }),
          ]),
        );
      });
      animRef.current = Animated.parallel(loops);
      animRef.current.start();
    } else {
      Animated.parallel(
        barAnims.map((anim) =>
          Animated.timing(anim, {
            toValue: BAR_MIN_H,
            duration: 200,
            useNativeDriver: false,
          }),
        ),
      ).start();
    }

    return () => {
      animRef.current?.stop();
      animRef.current = null;
    };
  }, [active, barAnims]);

  return (
    <View style={waveStyles.container}>
      {barAnims.map((anim, i) => (
        <Animated.View key={i} style={[waveStyles.bar, { height: anim }]} />
      ))}
    </View>
  );
}

function createWaveStyles(colors: ColorPalette) {
  return StyleSheet.create({
    container: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      overflow: "hidden",
      height: 26,
    },
    bar: {
      width: 2,
      borderRadius: 2,
      backgroundColor: colors.textSecondary,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────

interface ChatInputProps {
  inputRef: React.RefObject<TextInput | null>;
  mode?: "chat" | "translation";
  inputText: string;
  onChangeText: (text: string) => void;
  onOpenModelCatalog: () => void;
  onSend: () => void;
  onStop: () => void;
  onFocus: () => void;
  isGenerating: boolean;
  isLoading: boolean;
  loadedModelPath: string | null;
  isCompressingImage: boolean;
  pendingImageUri: string | null;
  pendingImageDisplayUri: string | null;
  onClearImage: () => void;
  attachMenuOpen: boolean;
  attachMenuAnim: Animated.Value;
  onAttachOpen: () => void;
  onAttachClose: () => void;
  onPickCamera: () => void;
  onPickLibrary: () => void;
  onPickDocument: () => void;
  isFileAttachmentDisabled: boolean;
  reasoningEnabled: boolean;
  modelSupportsThinking: boolean;
  modelSupportsVision: boolean;
  onToggleReasoning: () => void;
  webSearchEnabled: boolean;
  onToggleWebSearch: () => void;
  webSearchTemporarilyDisabled: boolean;
  modelSupportsWebSearch: boolean;
  translationSourceLabel?: string;
  translationTargetLabel?: string;
  translationCanSwap?: boolean;
  onPressTranslationSource?: () => void;
  onPressTranslationTarget?: () => void;
  onSwapTranslationLanguages?: () => void;
  attachedSources: RagSource[];
  onRemoveSource: (sourceId: string) => void;
  sourceStatusText: string | null;
  voiceAvailable: boolean;
  isRecordingVoice: boolean;
  isRecordingPaused: boolean;
  isTranscribingVoice: boolean;
  isPreparingVoice: boolean;
  onVoicePress: () => void;
  onDisableVoiceMode: () => void;
  onPauseResumeRecording: () => void;
  onTranscribeAndExit: () => void;
  bottomInset: number;
}

function ChatInputComponent({
  inputRef,
  mode = "chat",
  inputText,
  onChangeText,
  onOpenModelCatalog,
  onSend,
  onStop,
  onFocus,
  isGenerating,
  isLoading,
  loadedModelPath,
  isCompressingImage,
  pendingImageUri,
  pendingImageDisplayUri,
  onClearImage,
  attachMenuOpen,
  attachMenuAnim,
  onAttachOpen,
  onAttachClose,
  onPickCamera,
  onPickLibrary,
  onPickDocument,
  isFileAttachmentDisabled,
  reasoningEnabled,
  modelSupportsThinking,
  modelSupportsVision,
  onToggleReasoning,
  webSearchEnabled,
  onToggleWebSearch,
  webSearchTemporarilyDisabled,
  modelSupportsWebSearch,
  translationSourceLabel,
  translationTargetLabel,
  translationCanSwap = false,
  onPressTranslationSource,
  onPressTranslationTarget,
  onSwapTranslationLanguages,
  attachedSources,
  onRemoveSource,
  sourceStatusText,
  voiceAvailable,
  isRecordingVoice,
  isRecordingPaused,
  isTranscribingVoice,
  isPreparingVoice,
  onVoicePress,
  onDisableVoiceMode,
  onPauseResumeRecording,
  onTranscribeAndExit,
  bottomInset,
}: ChatInputProps): React.JSX.Element | null {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const isTranslationMode = mode === "translation";
  const canSend =
    !!(inputText.trim() || pendingImageUri) &&
    !!loadedModelPath &&
    !isCompressingImage;
  const canToggleReasoning =
    modelSupportsThinking && !pendingImageUri && !webSearchEnabled;
  const voiceButtonDisabled = isGenerating || !voiceAvailable;
  const voiceIconColor = voiceAvailable
    ? colors.textSecondary
    : colors.textTertiary;
  const isIOS = Platform.OS === "ios";
  const showModelCatalogRedirect = !loadedModelPath && !isLoading;
  const hideInputWhileModelLoads = !loadedModelPath && isLoading;

  const [recordingSec, setRecordingSec] = React.useState(0);
  const timerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const handleSubmitEditing = React.useCallback(() => {
    requestAnimationFrame(onSend);
  }, [onSend]);

  // Reset to 0 whenever a fresh recording session starts
  React.useEffect(() => {
    if (isRecordingVoice) {
      setRecordingSec(0);
    }
  }, [isRecordingVoice]);

  // Tick only while actively recording (not paused, not transcribing)
  React.useEffect(() => {
    if (isRecordingVoice && !isRecordingPaused && !isTranscribingVoice) {
      timerRef.current = setInterval(() => setRecordingSec((s) => s + 1), 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isRecordingVoice, isRecordingPaused, isTranscribingVoice]);

  if (showModelCatalogRedirect) {
    return (
      <View
        style={[styles.inputArea, { paddingBottom: bottomInset + SPACING.md }]}
      >
        <TouchableOpacity
          style={[styles.catalogRedirectCard, styles.modelStateCard]}
          onPress={onOpenModelCatalog}
          activeOpacity={0.8}
        >
          <View style={styles.catalogRedirectIcon}>
            <Ionicons name="albums-outline" size={18} color={colors.accent} />
          </View>
          <View style={styles.catalogRedirectBody}>
            <Text style={styles.catalogRedirectTitle}>
              {isTranslationMode
                ? "Choose a translation model"
                : "Explore our model catalog"}
            </Text>
          </View>
          <View style={styles.catalogRedirectTrailing}>
            <Ionicons
              name="chevron-forward"
              size={18}
              color={colors.textTertiary}
            />
          </View>
        </TouchableOpacity>
      </View>
    );
  }

  if (hideInputWhileModelLoads) {
    return (
      <View
        style={[styles.inputArea, { paddingBottom: bottomInset + SPACING.md }]}
      >
        <View style={styles.inputCard}>
          {isTranslationMode ? (
            <View style={styles.translationToolbar}>
              <View style={styles.translationSelectorRow}>
                <View style={styles.translationChip}>
                  <Text style={styles.translationChipLabel}>Source</Text>
                  <View style={styles.translationChipValueRow}>
                    <Text style={styles.translationChipValue} numberOfLines={1}>
                      {translationSourceLabel ?? "Auto-detect"}
                    </Text>
                    <Ionicons
                      name="chevron-down"
                      size={12}
                      color={colors.textTertiary}
                    />
                  </View>
                </View>

                <View
                  style={[
                    styles.translationSwapButton,
                    styles.translationSwapButtonDisabled,
                  ]}
                >
                  <Ionicons
                    name="swap-horizontal"
                    size={16}
                    color={colors.textTertiary}
                  />
                </View>

                <View style={styles.translationChip}>
                  <Text style={styles.translationChipLabel}>Target</Text>
                  <View style={styles.translationChipValueRow}>
                    <Text style={styles.translationChipValue} numberOfLines={1}>
                      {translationTargetLabel ?? "English"}
                    </Text>
                    <Ionicons
                      name="chevron-down"
                      size={12}
                      color={colors.textTertiary}
                    />
                  </View>
                </View>
              </View>
            </View>
          ) : null}

          <View style={styles.loadingInputRow}></View>

          <View style={styles.inputActions}>
            {!isTranslationMode ? (
              isLiquidGlassAvailable() ? (
                <GlassView isInteractive style={styles.iconGlass}>
                  <View style={styles.iconGlassInner}>
                    <Ionicons
                      name="add"
                      size={22}
                      color={colors.textSecondary}
                    />
                  </View>
                </GlassView>
              ) : (
                <View style={styles.plusButton}>
                  <Ionicons name="add" size={22} color={colors.textSecondary} />
                </View>
              )
            ) : null}
            {!isTranslationMode ? (
              isLiquidGlassAvailable() ? (
                <GlassView isInteractive style={styles.iconGlass}>
                  <View style={styles.iconGlassInner}>
                    <Ionicons
                      name="bulb-outline"
                      size={19}
                      color={colors.textSecondary}
                    />
                  </View>
                </GlassView>
              ) : (
                <View style={styles.brainButton}>
                  <Ionicons
                    name="bulb-outline"
                    size={19}
                    color={colors.textSecondary}
                  />
                </View>
              )
            ) : null}
            {!isTranslationMode && modelSupportsWebSearch ? (
              isLiquidGlassAvailable() ? (
                <GlassView isInteractive style={styles.iconGlass}>
                  <View style={styles.iconGlassInner}>
                    <Ionicons
                      name="globe-outline"
                      size={18}
                      color={colors.textSecondary}
                    />
                  </View>
                </GlassView>
              ) : (
                <View style={styles.brainButton}>
                  <Ionicons
                    name="globe-outline"
                    size={18}
                    color={colors.textSecondary}
                  />
                </View>
              )
            ) : null}
            <View style={styles.inputActionsSpacer} />
            {isLiquidGlassAvailable() ? (
              <GlassView isInteractive style={styles.iconGlass}>
                <View style={styles.iconGlassInner}>
                  <Ionicons
                    name="mic-outline"
                    size={18}
                    color={colors.textSecondary}
                  />
                </View>
              </GlassView>
            ) : (
              <View style={styles.voiceButton}>
                <Ionicons
                  name="mic-outline"
                  size={18}
                  color={colors.textSecondary}
                />
              </View>
            )}
            {isLiquidGlassAvailable() ? (
              <GlassView isInteractive style={styles.iconGlass}>
                <View style={styles.iconGlassInner}>
                  <ActivityIndicator size="small" color={colors.accent} />
                </View>
              </GlassView>
            ) : (
              <View style={styles.sendButton}>
                <ActivityIndicator size="small" color={colors.base} />
              </View>
            )}
          </View>
        </View>
      </View>
    );
  }

  return (
    <View
      style={[styles.inputArea, { paddingBottom: bottomInset + SPACING.md }]}
    >
      {/* Inline attach submenu — floats above the input card */}
      {attachMenuOpen && (
        <Animated.View
          style={[
            styles.attachMenuContainer,
            {
              opacity: attachMenuAnim,
              transform: [
                {
                  scale: attachMenuAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.92, 1],
                  }),
                },
              ],
            },
          ]}
          pointerEvents="box-none"
        >
          <View style={styles.attachMenu}>
            <TouchableOpacity
              style={[
                styles.attachMenuItem,
                !modelSupportsVision ? styles.attachMenuItemDisabled : null,
              ]}
              onPress={modelSupportsVision ? onPickCamera : undefined}
              disabled={!modelSupportsVision}
              activeOpacity={0.7}
            >
              <Ionicons
                name="camera-outline"
                size={20}
                color={
                  modelSupportsVision
                    ? colors.textPrimary
                    : colors.textTertiary
                }
              />
              <Text
                style={[
                  styles.attachMenuItemText,
                  !modelSupportsVision
                    ? styles.attachMenuItemTextDisabled
                    : null,
                ]}
              >
                Camera
              </Text>
            </TouchableOpacity>
            <View style={styles.attachMenuDivider} />
            <TouchableOpacity
              style={[
                styles.attachMenuItem,
                !modelSupportsVision ? styles.attachMenuItemDisabled : null,
              ]}
              onPress={modelSupportsVision ? onPickLibrary : undefined}
              disabled={!modelSupportsVision}
              activeOpacity={0.7}
            >
              <Ionicons
                name="images-outline"
                size={20}
                color={
                  modelSupportsVision
                    ? colors.textPrimary
                    : colors.textTertiary
                }
              />
              <Text
                style={[
                  styles.attachMenuItemText,
                  !modelSupportsVision
                    ? styles.attachMenuItemTextDisabled
                    : null,
                ]}
              >
                Photo Library
              </Text>
            </TouchableOpacity>
            <View style={styles.attachMenuDivider} />
            <TouchableOpacity
              style={[
                styles.attachMenuItem,
                isFileAttachmentDisabled ? styles.attachMenuItemDisabled : null,
              ]}
              onPress={isFileAttachmentDisabled ? undefined : onPickDocument}
              disabled={isFileAttachmentDisabled}
              activeOpacity={0.7}
            >
              <Ionicons
                name="document-text-outline"
                size={20}
                color={
                  isFileAttachmentDisabled
                    ? colors.textTertiary
                    : colors.textPrimary
                }
              />
              <Text
                style={[
                  styles.attachMenuItemText,
                  isFileAttachmentDisabled
                    ? styles.attachMenuItemTextDisabled
                    : null,
                ]}
              >
                Files
              </Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      )}

      <View style={styles.inputCard}>
        {isTranslationMode ? (
          <View style={styles.translationToolbar}>
            <View style={styles.translationSelectorRow}>
              <TouchableOpacity
                style={styles.translationChip}
                onPress={onPressTranslationSource}
                activeOpacity={0.8}
              >
                <Text style={styles.translationChipLabel}>Source</Text>
                <View style={styles.translationChipValueRow}>
                  <Text style={styles.translationChipValue} numberOfLines={1}>
                    {translationSourceLabel ?? "Auto-detect"}
                  </Text>
                  <Ionicons
                    name="chevron-down"
                    size={12}
                    color={colors.textTertiary}
                  />
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.translationSwapButton,
                  !translationCanSwap && styles.translationSwapButtonDisabled,
                ]}
                onPress={
                  translationCanSwap ? onSwapTranslationLanguages : undefined
                }
                disabled={!translationCanSwap}
                activeOpacity={0.8}
              >
                <Ionicons
                  name="swap-horizontal"
                  size={16}
                  color={
                    translationCanSwap ? colors.accent : colors.textTertiary
                  }
                />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.translationChip}
                onPress={onPressTranslationTarget}
                activeOpacity={0.8}
              >
                <Text style={styles.translationChipLabel}>Target</Text>
                <View style={styles.translationChipValueRow}>
                  <Text style={styles.translationChipValue} numberOfLines={1}>
                    {translationTargetLabel ?? "English"}
                  </Text>
                  <Ionicons
                    name="chevron-down"
                    size={12}
                    color={colors.textTertiary}
                  />
                </View>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        {!isTranslationMode && attachedSources.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.sourceChipRow}
          >
            {attachedSources.map((source) => (
              <View key={source.id} style={styles.sourceChip}>
                <Ionicons
                  name="document-text-outline"
                  size={14}
                  color={colors.accent}
                />
                <Text style={styles.sourceChipText} numberOfLines={1}>
                  {source.name}
                </Text>
                <TouchableOpacity
                  onPress={() => onRemoveSource(source.id)}
                  hitSlop={8}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name="close"
                    size={14}
                    color={colors.textSecondary}
                  />
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>
        ) : null}

        {!isTranslationMode && sourceStatusText ? (
          <View style={styles.sourceStatusRow}>
            <ActivityIndicator size="small" color={colors.accent} />
            <Text style={styles.sourceStatusText}>{sourceStatusText}</Text>
          </View>
        ) : null}

        {!isTranslationMode && webSearchEnabled ? (
          <View style={styles.webSearchDisclosureRow}>
            <Ionicons name="globe-outline" size={14} color={colors.accent} />
            <Text style={styles.webSearchDisclosureText}>
              Web Search Powered by DuckDuckGo.
            </Text>
          </View>
        ) : null}

        {/* Image preview / compression spinner */}
        {pendingImageDisplayUri || pendingImageUri || isCompressingImage ? (
          <View style={styles.imagePreviewRow}>
            {isCompressingImage ? (
              <View style={styles.imageCompressingPlaceholder}>
                <ActivityIndicator size="small" color={colors.accent} />
              </View>
            ) : (
              <>
                <Image
                  source={{ uri: pendingImageDisplayUri! }}
                  style={styles.imagePreview}
                />
                <TouchableOpacity
                  style={styles.imagePreviewClear}
                  onPress={onClearImage}
                  hitSlop={8}
                >
                  <View style={styles.imagePreviewClearBg}>
                    <Ionicons name="close" size={12} color="#fff" />
                  </View>
                </TouchableOpacity>
              </>
            )}
          </View>
        ) : null}

        <TextInput
          ref={inputRef}
          style={styles.input}
          value={inputText}
          onChangeText={onChangeText}
          placeholder={
            isTranslationMode ? "Paste text to translate" : "Ask TensorChat"
          }
          placeholderTextColor={colors.textTertiary}
          multiline
          editable={!!loadedModelPath && !isLoading}
          returnKeyType="send"
          autoCorrect={isIOS ? false : undefined}
          spellCheck={isIOS ? false : undefined}
          autoComplete={isIOS ? "off" : undefined}
          textContentType={isIOS ? "none" : undefined}
          smartInsertDelete={isIOS ? false : undefined}
          submitBehavior="submit"
          onSubmitEditing={handleSubmitEditing}
          onFocus={onFocus}
        />

        {(isRecordingVoice || isTranscribingVoice) && (
          <View style={styles.recordingStrip}>
            {isTranscribingVoice ? (
              <View style={styles.recordingMiddle}>
                <ActivityIndicator size="small" color={colors.accent} />
                <Text style={styles.recordingTranscribingText}>
                  Transcribing your speech…
                </Text>
              </View>
            ) : (
              <>
                <TouchableOpacity
                  style={styles.recordingPauseButton}
                  onPress={onPauseResumeRecording}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={isRecordingPaused ? "play" : "pause"}
                    size={18}
                    color={colors.textPrimary}
                  />
                </TouchableOpacity>
                <View style={styles.recordingMiddle}>
                  <SoundWaveform active={!isRecordingPaused} />
                </View>
                <Text style={styles.recordingTimer}>
                  {`${Math.floor(recordingSec / 60)}:${(recordingSec % 60).toString().padStart(2, "0")}`}
                </Text>
                <TouchableOpacity
                  style={styles.recordingConfirmButton}
                  onPress={onTranscribeAndExit}
                  activeOpacity={0.7}
                >
                  <Ionicons name="checkmark" size={18} color={colors.base} />
                </TouchableOpacity>
              </>
            )}
          </View>
        )}
        {!isRecordingVoice && !isTranscribingVoice && (
          <View style={styles.inputActions}>
            {/* Plus / attach button */}
            {!isTranslationMode && isLiquidGlassAvailable() ? (
              <GlassView
                isInteractive
                style={[
                  styles.iconGlass,
                  attachMenuOpen && styles.iconGlassActive,
                ]}
              >
                <TouchableOpacity
                  testID="attach-button"
                  style={styles.iconGlassInner}
                  onPress={attachMenuOpen ? onAttachClose : onAttachOpen}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name="add"
                    size={22}
                    color={
                      attachMenuOpen ? colors.accent : colors.textSecondary
                    }
                  />
                </TouchableOpacity>
              </GlassView>
            ) : !isTranslationMode ? (
              <TouchableOpacity
                testID="attach-button"
                style={[
                  styles.plusButton,
                  attachMenuOpen && styles.plusButtonActive,
                ]}
                onPress={attachMenuOpen ? onAttachClose : onAttachOpen}
                activeOpacity={0.7}
              >
                <Ionicons
                  name="add"
                  size={22}
                  color={attachMenuOpen ? colors.accent : colors.textSecondary}
                />
              </TouchableOpacity>
            ) : null}

            {/* Image attached indicator */}
            {!isTranslationMode &&
              !!pendingImageUri &&
              (isLiquidGlassAvailable() ? (
                <GlassView
                  isInteractive
                  style={[styles.iconGlass, styles.iconGlassActive]}
                >
                  <TouchableOpacity
                    style={styles.iconGlassInner}
                    onPress={onClearImage}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="image" size={20} color={colors.accent} />
                  </TouchableOpacity>
                </GlassView>
              ) : (
                <TouchableOpacity
                  style={[styles.plusButton, styles.plusButtonActive]}
                  onPress={onClearImage}
                  activeOpacity={0.7}
                >
                  <Ionicons name="image" size={20} color={colors.accent} />
                </TouchableOpacity>
              ))}

            {/* Thinking toggle */}
            {!isTranslationMode ? (
              isLiquidGlassAvailable() ? (
                <GlassView
                  isInteractive
                  style={[
                    styles.iconGlass,
                    !canToggleReasoning && styles.brainButtonDisabled,
                  ]}
                >
                  <TouchableOpacity
                    testID="thinking-toggle"
                    style={[
                      styles.iconGlassInner,
                      reasoningEnabled &&
                        canToggleReasoning &&
                        styles.brainButtonActive,
                    ]}
                    onPress={canToggleReasoning ? onToggleReasoning : undefined}
                    disabled={!canToggleReasoning}
                    activeOpacity={canToggleReasoning ? 0.7 : 1}
                  >
                    <Ionicons
                      name={
                        reasoningEnabled && canToggleReasoning
                          ? "bulb"
                          : "bulb-outline"
                      }
                      size={19}
                      color={
                        !canToggleReasoning
                          ? colors.textTertiary
                          : reasoningEnabled
                            ? colors.accent
                            : colors.textSecondary
                      }
                    />
                  </TouchableOpacity>
                </GlassView>
              ) : (
                <TouchableOpacity
                  testID="thinking-toggle"
                  style={[
                    styles.brainButton,
                    reasoningEnabled &&
                      canToggleReasoning &&
                      styles.brainButtonActive,
                    !canToggleReasoning && styles.brainButtonDisabled,
                  ]}
                  onPress={canToggleReasoning ? onToggleReasoning : undefined}
                  disabled={!canToggleReasoning}
                  activeOpacity={canToggleReasoning ? 0.7 : 1}
                >
                  <Ionicons
                    name={
                      reasoningEnabled && canToggleReasoning
                        ? "bulb"
                        : "bulb-outline"
                    }
                    size={19}
                    color={
                      !canToggleReasoning
                        ? colors.textTertiary
                        : reasoningEnabled
                          ? colors.accent
                          : colors.textSecondary
                    }
                  />
                </TouchableOpacity>
              )
            ) : null}

            {!isTranslationMode && modelSupportsWebSearch ? (
              isLiquidGlassAvailable() ? (
                <GlassView
                  isInteractive
                  style={[
                    styles.iconGlass,
                    webSearchTemporarilyDisabled && styles.brainButtonDisabled,
                  ]}
                >
                  <TouchableOpacity
                    testID="web-search-toggle"
                    style={[
                      styles.iconGlassInner,
                      webSearchEnabled &&
                        !webSearchTemporarilyDisabled &&
                        styles.brainButtonActive,
                    ]}
                    onPress={
                      webSearchTemporarilyDisabled
                        ? undefined
                        : onToggleWebSearch
                    }
                    activeOpacity={webSearchTemporarilyDisabled ? 1 : 0.7}
                  >
                    <Ionicons
                      name={webSearchEnabled ? "globe" : "globe-outline"}
                      size={18}
                      color={
                        webSearchTemporarilyDisabled
                          ? colors.textTertiary
                          : webSearchEnabled
                            ? colors.accent
                            : colors.textSecondary
                      }
                    />
                  </TouchableOpacity>
                </GlassView>
              ) : (
                <TouchableOpacity
                  testID="web-search-toggle"
                  style={[
                    styles.brainButton,
                    webSearchEnabled &&
                      !webSearchTemporarilyDisabled &&
                      styles.brainButtonActive,
                    webSearchTemporarilyDisabled && styles.brainButtonDisabled,
                  ]}
                  onPress={
                    webSearchTemporarilyDisabled ? undefined : onToggleWebSearch
                  }
                  activeOpacity={webSearchTemporarilyDisabled ? 1 : 0.7}
                >
                  <Ionicons
                    name={webSearchEnabled ? "globe" : "globe-outline"}
                    size={18}
                    color={
                      webSearchTemporarilyDisabled
                        ? colors.textTertiary
                        : webSearchEnabled
                          ? colors.accent
                          : colors.textSecondary
                    }
                  />
                </TouchableOpacity>
              )
            ) : null}

            <View style={styles.inputActionsSpacer} />

            {/* Voice input button */}
            {isLiquidGlassAvailable() ? (
              <GlassView isInteractive style={styles.iconGlass}>
                <TouchableOpacity
                  style={styles.iconGlassInner}
                  onPress={onVoicePress}
                  disabled={voiceButtonDisabled}
                  activeOpacity={0.8}
                >
                  {isTranscribingVoice || isPreparingVoice ? (
                    <ActivityIndicator size="small" color={colors.accent} />
                  ) : (
                    <Ionicons
                      name="mic-outline"
                      size={18}
                      color={voiceIconColor}
                    />
                  )}
                </TouchableOpacity>
              </GlassView>
            ) : (
              <TouchableOpacity
                style={styles.voiceButton}
                onPress={onVoicePress}
                disabled={voiceButtonDisabled}
                activeOpacity={0.8}
              >
                {isTranscribingVoice || isPreparingVoice ? (
                  <ActivityIndicator size="small" color={colors.accent} />
                ) : (
                  <Ionicons
                    name="mic-outline"
                    size={18}
                    color={voiceIconColor}
                  />
                )}
              </TouchableOpacity>
            )}

            {/* Send / Stop button */}
            {isLiquidGlassAvailable() ? (
              <GlassView isInteractive style={styles.iconGlass}>
                <TouchableOpacity
                  testID="send-button"
                  style={styles.iconGlassInner}
                  onPress={isGenerating ? onStop : onSend}
                  disabled={!isGenerating && !canSend}
                  activeOpacity={0.8}
                >
                  {isGenerating ? (
                    <Ionicons
                      name="stop"
                      size={18}
                      color={colors.textPrimary}
                    />
                  ) : (
                    <Ionicons
                      name="arrow-up"
                      size={20}
                      color={canSend ? colors.accent : colors.textTertiary}
                    />
                  )}
                </TouchableOpacity>
              </GlassView>
            ) : (
              <TouchableOpacity
                testID="send-button"
                style={[
                  styles.sendButton,
                  !isGenerating && !canSend && styles.sendButtonDisabled,
                ]}
                onPress={isGenerating ? onStop : onSend}
                disabled={!isGenerating && !canSend}
                activeOpacity={0.8}
              >
                {isGenerating ? (
                  <Ionicons name="stop" size={18} color={colors.textPrimary} />
                ) : (
                  <Ionicons
                    name="arrow-up"
                    size={20}
                    color={canSend ? colors.accent : colors.textTertiary}
                  />
                )}
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

export const ChatInput = memo(ChatInputComponent);

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    inputArea: {
      paddingHorizontal: SPACING.lg,
    },
    modelStateCard: {
      minHeight: 68,
    },
    catalogRedirectCard: {
      backgroundColor: colors.surface,
      borderRadius: 20,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.md,
      flexDirection: "row",
      alignItems: "center",
      gap: SPACING.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    catalogRedirectIcon: {
      width: 36,
      height: 36,
      borderRadius: RADII.full,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.accentTint,
      flexShrink: 0,
    },
    catalogRedirectBody: {
      flex: 1,
      gap: 2,
      alignItems: "center",
    },
    catalogRedirectTitle: {
      fontSize: 15,
      fontWeight: FONT.semibold,
      color: colors.textPrimary,
      textAlign: "center",
    },
    catalogRedirectTrailing: {
      width: 36,
      height: 36,
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
    },
    inputCard: {
      backgroundColor: colors.surface,
      borderRadius: 20,
      paddingHorizontal: SPACING.md,
      paddingTop: SPACING.sm,
      paddingBottom: SPACING.sm,
    },
    translationToolbar: {
      gap: SPACING.sm,
      paddingBottom: SPACING.sm,
    },
    translationSelectorRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: SPACING.sm,
    },
    translationChip: {
      flex: 1,
      minWidth: 0,
      borderRadius: RADII.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.base,
      paddingHorizontal: SPACING.sm,
      paddingVertical: SPACING.xs + 2,
    },
    translationChipLabel: {
      fontSize: 11,
      color: colors.textTertiary,
      marginBottom: 2,
    },
    translationChipValueRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: SPACING.xs,
      minWidth: 0,
    },
    translationChipValue: {
      flex: 1,
      fontSize: 14,
      fontWeight: FONT.medium,
      color: colors.textPrimary,
    },
    translationSwapButton: {
      width: 32,
      height: 32,
      borderRadius: RADII.full,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.accentTint,
      flexShrink: 0,
    },
    translationSwapButtonDisabled: {
      opacity: 0.45,
    },
    sourceChipRow: {
      gap: SPACING.sm,
      paddingBottom: SPACING.sm,
    },
    sourceChip: {
      maxWidth: 220,
      flexDirection: "row",
      alignItems: "center",
      gap: SPACING.xs,
      paddingHorizontal: SPACING.sm,
      paddingVertical: 6,
      borderRadius: RADII.pill,
      backgroundColor: colors.base,
    },
    sourceChipText: {
      flexShrink: 1,
      fontSize: 13,
      color: colors.textPrimary,
    },
    sourceStatusRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: SPACING.sm,
      paddingBottom: SPACING.sm,
    },
    sourceStatusText: {
      flex: 1,
      fontSize: 13,
      color: colors.textSecondary,
    },
    webSearchDisclosureRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: SPACING.xs,
      paddingBottom: SPACING.sm,
    },
    webSearchDisclosureText: {
      flex: 1,
      fontSize: 12,
      lineHeight: 16,
      color: colors.textSecondary,
    },
    input: {
      minHeight: 40,
      maxHeight: 130,
      fontSize: 16,
      color: colors.textPrimary,
      paddingVertical: SPACING.xs,
    },
    loadingInputRow: {
      minHeight: 40,
      flexDirection: "row",
      alignItems: "center",
      gap: SPACING.sm,
      paddingVertical: SPACING.xs,
    },
    loadingInputText: {
      flex: 1,
      fontSize: 16,
      color: colors.textTertiary,
    },
    inputActions: {
      flexDirection: "row",
      alignItems: "center",
      marginTop: SPACING.xs,
      gap: SPACING.sm,
    },
    inputActionsSpacer: {
      flex: 1,
    },
    iconGlass: {
      borderRadius: 50,
      overflow: "hidden",
    },
    iconGlassInner: {
      width: 36,
      height: 36,
      alignItems: "center",
      justifyContent: "center",
    },
    iconGlassActive: {
      backgroundColor: colors.accentTint,
    },
    plusButton: {
      width: 32,
      height: 32,
      borderRadius: RADII.full,
      alignItems: "center",
      justifyContent: "center",
      marginRight: SPACING.xs,
    },
    plusButtonActive: {
      backgroundColor: colors.accentTint,
    },
    imagePreviewRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      paddingBottom: SPACING.sm,
    },
    imagePreview: {
      width: 64,
      height: 64,
      borderRadius: RADII.md,
      resizeMode: "cover",
    },
    imageCompressingPlaceholder: {
      width: 64,
      height: 64,
      borderRadius: RADII.md,
      backgroundColor: colors.surface,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: colors.border,
    },
    imagePreviewClear: {
      position: "absolute",
      top: -6,
      left: 54,
    },
    imagePreviewClearBg: {
      width: 18,
      height: 18,
      borderRadius: 9,
      backgroundColor: colors.overlayBg,
      alignItems: "center",
      justifyContent: "center",
    },
    attachMenuContainer: {
      position: "absolute",
      bottom: "100%",
      left: SPACING.md,
      marginBottom: SPACING.xs,
      minWidth: 180,
      zIndex: 100,
    },
    attachMenu: {
      borderRadius: RADII.lg,
      overflow: "hidden",
      backgroundColor: colors.sidebar,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.5,
      shadowRadius: 16,
      elevation: 8,
    },
    attachMenuItem: {
      flexDirection: "row",
      alignItems: "center",
      gap: SPACING.sm,
      paddingVertical: SPACING.sm + 2,
      paddingHorizontal: SPACING.md,
    },
    attachMenuItemDisabled: {
      opacity: 0.48,
    },
    attachMenuItemText: {
      fontSize: 15,
      color: colors.textPrimary,
      fontFamily: FONT.regular,
    },
    attachMenuItemTextDisabled: {
      color: colors.textTertiary,
    },
    attachMenuDivider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
      marginHorizontal: SPACING.md,
    },
    brainButton: {
      width: 32,
      height: 32,
      borderRadius: RADII.full,
      alignItems: "center",
      justifyContent: "center",
    },
    brainButtonActive: {
      backgroundColor: colors.accentTint,
    },
    brainButtonDisabled: {
      opacity: 0.35,
    },
    voiceButton: {
      width: 32,
      height: 32,
      borderRadius: RADII.full,
      alignItems: "center",
      justifyContent: "center",
    },
    sendButton: {
      width: 36,
      height: 36,
      borderRadius: RADII.full,
      backgroundColor: colors.accent,
      alignItems: "center",
      justifyContent: "center",
    },
    sendButtonDisabled: {
      backgroundColor: colors.surfaceHover,
      borderWidth: 0,
    },
    recordingStrip: {
      flexDirection: "row",
      alignItems: "center",
      marginTop: SPACING.xs,
      gap: SPACING.sm,
      height: 36,
    },
    recordingPauseButton: {
      width: 36,
      height: 36,
      borderRadius: RADII.full,
      backgroundColor: colors.surfaceHover,
      alignItems: "center",
      justifyContent: "center",
    },
    recordingMiddle: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: SPACING.xs,
      overflow: "hidden",
    },
    recordingTimer: {
      fontSize: 13,
      color: colors.textSecondary,
      fontFamily: FONT.regular,
      width: 36,
      textAlign: "right",
    },
    recordingTranscribingText: {
      fontSize: 13,
      color: colors.textSecondary,
      fontFamily: FONT.regular,
      flexShrink: 1,
    },
    recordingConfirmButton: {
      width: 36,
      height: 36,
      borderRadius: RADII.full,
      backgroundColor: colors.textPrimary,
      alignItems: "center",
      justifyContent: "center",
    },
  });
}
