import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Image,
  Linking,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Animated,
  Easing,
  LayoutAnimation,
  Platform,
  UIManager,
  ScrollView,
  Clipboard,
} from 'react-native';
import { EnrichedMarkdownText, type MarkdownStyle, type Md4cFlags } from 'react-native-enriched-markdown';
import { Ionicons } from '@expo/vector-icons';
import { ColorPalette, FONT, RADII, SPACING } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import type { LlamaToolCall } from '../hooks/useLlama';
import type { RagSourceType } from '../types/fileRag';
import type { WebSearchResult } from '../types/webSearch';
import { splitMarkdownForRendering } from '../utils/markdownLatex';
import { parseThinking, stripToolCallMarkup } from '../utils/reasoning';
import {
  detectTranslationSourceLanguage,
  getDetectedTranslationLanguageLabel,
} from '../utils/translationLanguage';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

function BlinkingCursor({ style }: { style: object }) {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0, duration: 400, easing: Easing.ease, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 400, easing: Easing.ease, useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [opacity]);
  return <Animated.Text style={[style, { opacity }]}>▋</Animated.Text>;
}

export interface MessageAttachment {
  sourceId: string;
  name: string;
  type?: RagSourceType;
  size?: number | null;
}

export interface ToolResultMessage {
  toolCallId: string;
  toolName: string;
  content: string;
  isError?: boolean;
}

export interface AssistantToolTranscript {
  content: string;
  toolCalls: LlamaToolCall[];
  toolResults: ToolResultMessage[];
}

export interface TranslationMessageBadge {
  label: string;
  tone?: 'source' | 'target';
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  // Raw output from the model — may contain <think>...</think> tags, parsed at render time
  content: string;
  isStreaming?: boolean;
  reasoningComplete?: boolean;
  imageUri?: string;         // base64 data URL — used for inference
  imageDisplayUri?: string;  // original file URI — used for display (preserves EXIF orientation)
  attachedSources?: MessageAttachment[];
  searchQuery?: string;
  webSearchResults?: WebSearchResult[];
  toolTranscript?: AssistantToolTranscript;
  translationBadge?: TranslationMessageBadge;
  ttsAdvisory?: string;
  webSearchAdvisory?: string;
}

interface MessageBubbleProps {
  message: Message;
  onSpeak?: (messageId: string, text: string) => void;
  onRetry?: () => void;
  showRetry?: boolean;
  retryDisabled?: boolean;
  isSpeaking?: boolean;
  isTTSSyncing?: boolean;
  ttsDisabled?: boolean;
}

function areMessageBubblePropsEqual(
  previous: MessageBubbleProps,
  next: MessageBubbleProps,
): boolean {
  return previous.message === next.message
    && previous.onSpeak === next.onSpeak
    && previous.onRetry === next.onRetry
    && previous.showRetry === next.showRetry
    && previous.retryDisabled === next.retryDisabled
    && previous.isSpeaking === next.isSpeaking
    && previous.isTTSSyncing === next.isTTSSyncing
    && previous.ttsDisabled === next.ttsDisabled;
}

// Brief icon flash feedback on copy.
function CopyButton({ text, align }: { text: string; align: 'left' | 'right' }): React.JSX.Element {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    Clipboard.setString(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <TouchableOpacity
      style={[styles.copyButton, align === 'right' ? styles.copyButtonRight : styles.copyButtonLeft]}
      onPress={handleCopy}
      activeOpacity={0.6}
      hitSlop={8}
    >
      <Ionicons
        name={copied ? 'checkmark' : 'copy-outline'}
        size={14}
        color={copied ? colors.accent : colors.textTertiary}
      />
    </TouchableOpacity>
  );
}

function SpeakButton({
  isSpeaking,
  isTTSSyncing,
  disabled,
  onPress,
}: {
  isSpeaking: boolean;
  isTTSSyncing: boolean;
  disabled: boolean;
  onPress: () => void;
}): React.JSX.Element {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const showSpinner = isTTSSyncing && !isSpeaking;
  const spinnerOpacity = useRef(new Animated.Value(showSpinner ? 1 : 0)).current;
  const iconOpacity = useRef(new Animated.Value(showSpinner ? 0 : 1)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(spinnerOpacity, {
        toValue: showSpinner ? 1 : 0,
        duration: 180,
        useNativeDriver: true,
      }),
      Animated.timing(iconOpacity, {
        toValue: showSpinner ? 0 : 1,
        duration: 180,
        useNativeDriver: true,
      }),
    ]).start();
  }, [showSpinner, spinnerOpacity, iconOpacity]);

  return (
    <TouchableOpacity
      style={styles.speakButton}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.6}
      hitSlop={8}
    >
      <Animated.View style={[StyleSheet.absoluteFill, styles.speakButtonInner, { opacity: spinnerOpacity }]}>
        <ActivityIndicator size="small" color={colors.accent} style={{ transform: [{ scale: 0.5 }] }} />
      </Animated.View>
      <Animated.View style={[styles.speakButtonInner, { opacity: iconOpacity }]}>
        <Ionicons
          name={isSpeaking ? 'stop-circle-outline' : 'volume-high-outline'}
          size={15}
          color={disabled ? colors.textTertiary : isSpeaking ? colors.accent : colors.textTertiary}
        />
      </Animated.View>
    </TouchableOpacity>
  );
}

function RetryButton({
  disabled,
  onPress,
}: {
  disabled: boolean;
  onPress: () => void;
}): React.JSX.Element {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <TouchableOpacity
      style={styles.retryButton}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.6}
      hitSlop={8}
    >
      <Ionicons
        name='refresh-outline'
        size={15}
        color={disabled ? colors.textTertiary : colors.textSecondary}
      />
    </TouchableOpacity>
  );
}

function formatToolArguments(argumentsText: string): string {
  try {
    const parsed = JSON.parse(argumentsText) as Record<string, unknown>;
    // LFM models may use alternative parameter names (e.g. "search" instead of "query")
    const query = typeof parsed.query === 'string' ? parsed.query.trim()
      : typeof parsed.search === 'string' ? parsed.search.trim()
      : typeof parsed.search_query === 'string' ? parsed.search_query.trim()
      : '';
    if (query) {
      return query;
    }

    // If no query-like field was found, return empty string so the badge
    // label falls back to just the tool name (e.g. "Search") instead of
    // showing raw JSON like {"max_results":5}.
    return '';
  } catch {
    return stripToolCallMarkup(argumentsText).trim();
  }
}

function getToolCallBadgeLabel(toolCall: LlamaToolCall): string {
  const formattedArguments = formatToolArguments(toolCall.function.arguments);

  if (toolCall.function.name === 'web_search') {
    return formattedArguments ? `Search: ${formattedArguments}` : 'Search';
  }

  return formattedArguments
    ? `${toolCall.function.name}: ${formattedArguments}`
    : toolCall.function.name;
}

function getToolCallBadgeIcon(toolCall: LlamaToolCall): React.ComponentProps<typeof Ionicons>['name'] {
  if (toolCall.function.name === 'web_search') {
    return 'globe-outline';
  }

  return 'construct-outline';
}

function dedupeVisibleToolCalls(toolCalls: LlamaToolCall[]): LlamaToolCall[] {
  const deduped = new Map<string, LlamaToolCall>();

  toolCalls.forEach((toolCall) => {
    const key = `${toolCall.function.name}:${toolCall.function.arguments.trim()}`;
    if (!deduped.has(key)) {
      deduped.set(key, toolCall);
    }
  });

  return Array.from(deduped.values());
}

function getCitationSourceLabel(result: WebSearchResult): string {
  const fallbackSource = result.source.trim();

  if (fallbackSource.length > 0) {
    return fallbackSource;
  }

  try {
    return new URL(result.url).hostname.replace(/^www\./i, '');
  } catch {
    return result.url;
  }
}

function buildVisibleCitations(results: WebSearchResult[]): WebSearchResult[] {
  const deduped = new Map<string, WebSearchResult>();

  results.forEach((result) => {
    const key = getCitationSourceLabel(result).toLowerCase();
    if (!deduped.has(key)) {
      deduped.set(key, result);
    }
  });

  return Array.from(deduped.values());
}

function isSearchingStatusMessage(content: string): boolean {
  return /^Searching DuckDuckGo(?: for ".+")?\.\.\.$/.test(content.trim());
}

// Three dots that pulse in staggered sequence, like ChatGPT's thinking indicator.
function PulsingDots(): React.JSX.Element {
  const { colors } = useTheme();
  const dotStyles = useMemo(() => createDotStyles(colors), [colors]);
  const dot1 = useRef(new Animated.Value(0.3)).current;
  const dot2 = useRef(new Animated.Value(0.3)).current;
  const dot3 = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const STAGGER = 160; // ms between each dot start
    const animations = [dot1, dot2, dot3].map((dot, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * STAGGER),
          Animated.timing(dot, {
            toValue: 1,
            duration: 400,
            useNativeDriver: true,
            easing: Easing.inOut(Easing.ease),
          }),
          Animated.timing(dot, {
            toValue: 0.3,
            duration: 400,
            useNativeDriver: true,
            easing: Easing.inOut(Easing.ease),
          }),
          // Padding so all dots share the same 1120ms cycle length
          Animated.delay(Math.max(0, 320 - i * STAGGER)),
        ]),
      ),
    );
    animations.forEach((a) => a.start());
    return () => animations.forEach((a) => a.stop());
  }, [dot1, dot2, dot3]);

  return (
    <View style={dotStyles.container}>
      {[dot1, dot2, dot3].map((dot, i) => (
        <Animated.View key={i} style={[dotStyles.dot, { opacity: dot }]} />
      ))}
    </View>
  );
}

function createDotStyles(colors: ColorPalette) {
  return StyleSheet.create({
    container: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.textSecondary },
  });
}

function createMarkdownStyles(colors: ColorPalette): MarkdownStyle {
  return {
    paragraph: {
      color: colors.textPrimary,
      fontSize: 15,
      lineHeight: 24,
      marginBottom: 4,
      marginTop: 0,
    },
    strong: {
      color: colors.textPrimary,
      fontWeight: FONT.semibold,
    },
    em: {
      color: colors.textSecondary,
      fontStyle: 'italic',
    },
    codeBlock: {
      backgroundColor: colors.sidebar,
      borderRadius: RADII.sm,
      borderColor: colors.sidebar,
      borderWidth: 0,
      padding: SPACING.md,
      marginBottom: SPACING.xs,
      marginTop: 0,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 13,
      lineHeight: 20,
      color: colors.textPrimary,
    },
    code: {
      backgroundColor: colors.surface,
      borderColor: colors.surface,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 13,
      color: colors.textPrimary,
    },
    link: {
      color: colors.accent,
    },
    list: {
      color: colors.textPrimary,
      fontSize: 15,
      lineHeight: 24,
      marginBottom: 4,
      marginTop: 0,
      bulletColor: colors.textSecondary,
      bulletSize: 3,
      markerColor: colors.textSecondary,
      gapWidth: SPACING.sm,
      marginLeft: 20,
    },
    h1: {
      color: colors.textPrimary,
      fontSize: 20,
      fontWeight: FONT.bold,
      marginBottom: SPACING.sm,
      marginTop: SPACING.md,
      lineHeight: 28,
    },
    h2: {
      color: colors.textPrimary,
      fontSize: 17,
      fontWeight: FONT.semibold,
      marginBottom: SPACING.xs,
      marginTop: SPACING.md,
      lineHeight: 24,
    },
    h3: {
      color: colors.textPrimary,
      fontSize: 15,
      fontWeight: FONT.semibold,
      marginBottom: SPACING.xs,
      marginTop: SPACING.sm,
      lineHeight: 22,
    },
    h4: {
      color: colors.textPrimary,
      fontSize: 15,
      fontWeight: FONT.semibold,
      marginBottom: SPACING.xs,
      marginTop: SPACING.sm,
      lineHeight: 22,
    },
    h5: {
      color: colors.textSecondary,
      fontSize: 14,
      fontWeight: FONT.semibold,
      marginBottom: SPACING.xs,
      marginTop: SPACING.sm,
      lineHeight: 20,
    },
    h6: {
      color: colors.textSecondary,
      fontSize: 13,
      fontWeight: FONT.semibold,
      marginBottom: SPACING.xs,
      marginTop: SPACING.sm,
      lineHeight: 18,
    },
    blockquote: {
      color: colors.textPrimary,
      fontSize: 15,
      lineHeight: 24,
      borderColor: colors.border,
      borderWidth: 3,
      gapWidth: SPACING.md,
      backgroundColor: 'transparent',
      marginBottom: SPACING.xs,
      marginTop: 0,
    },
    thematicBreak: {
      color: colors.border,
      height: 1,
      marginTop: SPACING.md,
      marginBottom: SPACING.md,
    },
    math: {
      color: colors.textPrimary,
      fontSize: 15,
      backgroundColor: 'transparent',
      padding: SPACING.sm,
      marginTop: 0,
      marginBottom: SPACING.xs,
      textAlign: 'center',
    },
    inlineMath: {
      color: colors.textPrimary,
    },
  };
}

const MARKDOWN_FLAGS: Md4cFlags = {
  underline: false,
  latexMath: true,
};

const MARKDOWN_RENDER_VERSION = '2026-03-07-1';

function getCodeBlockLines(content: string): string[] {
  const normalizedContent = content.endsWith('\n') ? content.slice(0, -1) : content;
  return normalizedContent.length > 0 ? normalizedContent.split('\n') : [''];
}

function MessageBubbleComponent({
  message,
  onSpeak,
  onRetry,
  showRetry = false,
  retryDisabled = false,
  isSpeaking = false,
  isTTSSyncing = false,
  ttsDisabled = false,
}: MessageBubbleProps): React.JSX.Element {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const markdownStyles = createMarkdownStyles(colors);
  const isUser = message.role === 'user';
  const [thinkingExpanded, setThinkingExpanded] = useState(false);
  const [citationsExpanded, setCitationsExpanded] = useState(false);
  const [thoughtDurationSec, setThoughtDurationSec] = useState<number | null>(null);
  const userToggledThinkingRef = useRef(false);
  const thinkStartedAtMsRef = useRef<number | null>(null);
  const messageStartedStreamingAtMsRef = useRef<number | null>(null);
  const wasStreamingRef = useRef<boolean>(!!message.isStreaming);
  const responseCollapseTriggeredRef = useRef(false);
  const thinkingScrollRef = useRef<ScrollView>(null);

  // Parse <think>...</think> tags from raw content at render time (private-mind pattern)
  const { thinking, response } = isUser
    ? { thinking: null, response: message.content }
    : parseThinking(message.content);
  const reasoningFinished = thinking !== null && !!message.reasoningComplete;

  useEffect(() => {
    const isStreaming = !!message.isStreaming;
    const wasStreaming = wasStreamingRef.current;

    if (!wasStreaming && isStreaming) {
      messageStartedStreamingAtMsRef.current = Date.now();
      setThoughtDurationSec(null);
      responseCollapseTriggeredRef.current = false;
    }

    if (isStreaming && thinking !== null) {
      if (reasoningFinished) {
        responseCollapseTriggeredRef.current = true;
        if (!userToggledThinkingRef.current) {
          setThinkingExpanded(false);
        }
      } else {
        if (thinkStartedAtMsRef.current === null) {
          thinkStartedAtMsRef.current = Date.now();
        }
        if (!userToggledThinkingRef.current) {
          if (response.length > 0 && !responseCollapseTriggeredRef.current) {
            // Response has started — collapse thinking with animation
            responseCollapseTriggeredRef.current = true;
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            setThinkingExpanded(false);
          } else if (response.length === 0) {
            setThinkingExpanded(true);
          }
        }
      }
    }

    if (wasStreaming && !isStreaming && thinking !== null) {
      const startMs = reasoningFinished
        ? null
        : thinkStartedAtMsRef.current ?? messageStartedStreamingAtMsRef.current;
      if (startMs !== null) {
        const elapsedSec = Math.max(1, Math.round((Date.now() - startMs) / 1000));
        setThoughtDurationSec(elapsedSec);
      }
      // Collapse automatically when thinking finishes.
      setThinkingExpanded(false);
      thinkStartedAtMsRef.current = null;
      messageStartedStreamingAtMsRef.current = null;
    }

    wasStreamingRef.current = isStreaming;
  }, [message.isStreaming, thinking, response, reasoningFinished]);

  useEffect(() => {
    if (thinking === null) {
      thinkStartedAtMsRef.current = null;
      messageStartedStreamingAtMsRef.current = null;
    }
  }, [thinking]);

  useEffect(() => {
    setCitationsExpanded(false);
  }, [message.id]);

  const isThinkingStreaming =
    message.isStreaming
    && thinking !== null
    && response === ''
    && !message.reasoningComplete;
  const isStreamingWithThinking = !!message.isStreaming && thinking !== null;
  const thoughtLabel = thoughtDurationSec !== null ? `Thought for ${thoughtDurationSec}s` : 'Reasoning';
  const showAssistantActions = !message.isStreaming && (response.length > 0 || showRetry);
  const isSearchStatusMessage = isSearchingStatusMessage(response);
  const visibleToolCalls = useMemo(
    () => dedupeVisibleToolCalls(message.toolTranscript?.toolCalls ?? []),
    [message.toolTranscript?.toolCalls],
  );
  const visibleCitations = useMemo(
    () => buildVisibleCitations(message.webSearchResults ?? []),
    [message.webSearchResults],
  );
  const ttsAdvisory = typeof message.ttsAdvisory === 'string'
    ? message.ttsAdvisory.trim()
    : '';
  const webSearchAdvisory = typeof message.webSearchAdvisory === 'string'
    ? message.webSearchAdvisory.trim()
    : '';
  const rawTranslationBadgeLabel = typeof message.translationBadge?.label === 'string'
    ? message.translationBadge.label.replace(/^(?:source|target):\s*/i, '').trim()
    : '';
  const translationBadgeLabel = useMemo(() => {
    if (rawTranslationBadgeLabel.length === 0) {
      return '';
    }

    if (rawTranslationBadgeLabel.toLowerCase() !== 'auto-detect' || message.role !== 'user') {
      return rawTranslationBadgeLabel;
    }

    return getDetectedTranslationLanguageLabel(
      detectTranslationSourceLanguage(message.content),
    );
  }, [message.content, message.role, rawTranslationBadgeLabel]);
  const translationBadgeTone = message.translationBadge?.tone === 'target'
    ? 'target'
    : 'source';
  const citationBadges = citationsExpanded
    ? visibleCitations
    : visibleCitations.slice(0, 3);
  const hiddenCitationCount = Math.max(0, visibleCitations.length - citationBadges.length);
  const renderedResponse = response + (message.isStreaming && !isThinkingStreaming ? ' ▋' : '');
  const preparedResponseSegments = splitMarkdownForRendering(renderedResponse);

  // Auto-scroll reasoning content to the bottom while tokens are streaming in.
  useEffect(() => {
    if (isThinkingStreaming && thinkingExpanded) {
      thinkingScrollRef.current?.scrollToEnd({ animated: false });
    }
  }, [thinking, isThinkingStreaming, thinkingExpanded]);

  const toggleThinking = () => {
    userToggledThinkingRef.current = true;
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setThinkingExpanded((v) => !v);
  };

  const expandCitations = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setCitationsExpanded(true);
  };

  const collapseCitations = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setCitationsExpanded(false);
  };

  if (isUser) {
    const hasAttachedSources = Array.isArray(message.attachedSources)
      && message.attachedSources.length > 0;

    return (
      <View style={styles.userContainer}>
        {message.imageUri ? (
          <Image
            source={{ uri: message.imageDisplayUri ?? message.imageUri }}
            style={styles.userImage}
            resizeMode="cover"
          />
        ) : null}
        {hasAttachedSources ? (
          <ScrollView
            horizontal
            style={styles.userAttachmentScroll}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.userAttachmentRow}
          >
            {message.attachedSources!.map((attachment) => (
              <View key={attachment.sourceId} style={styles.userAttachmentChip}>
                <Ionicons name="document-text-outline" size={14} color={colors.accent} />
                <Text style={styles.userAttachmentText} numberOfLines={1}>
                  {attachment.name}
                </Text>
              </View>
            ))}
          </ScrollView>
        ) : null}
        {message.content ? (
          <View style={styles.userBubble}>
            <Text style={styles.userText}>{message.content}</Text>
          </View>
        ) : null}
        {translationBadgeLabel.length > 0 ? (
          <View
            style={[
              styles.translationBadge,
              styles.userTranslationBadge,
              translationBadgeTone === 'target' && styles.translationBadgeTarget,
            ]}
          >
            <Text
              style={[
                styles.translationBadgeText,
                translationBadgeTone === 'target' && styles.translationBadgeTextTarget,
              ]}
              numberOfLines={1}
            >
              {translationBadgeLabel}
            </Text>
          </View>
        ) : null}
        {message.content && !message.isStreaming ? (
          <CopyButton text={message.content} align="right" />
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.assistantContainer}>
      {thinking !== null && (
        <View style={styles.thinkingWrapper}>
          <TouchableOpacity
            style={styles.thinkingHeader}
            onPress={toggleThinking}
            activeOpacity={0.6}
            disabled={isThinkingStreaming}
          >
            {isThinkingStreaming ? (
              <View style={styles.thinkingHeaderInner}>
                <PulsingDots />
                <Text style={styles.thinkingLabel}>Thinking…</Text>
              </View>
            ) : (
              <View style={styles.thinkingHeaderInner}>
                <Text style={styles.thinkingChevron}>{thinkingExpanded ? '▾' : '▸'}</Text>
                <Text style={styles.thinkingLabel}>{thoughtLabel}</Text>
              </View>
            )}
          </TouchableOpacity>
          {thinkingExpanded && (
            <View style={styles.thinkingBody}>
              <ScrollView
                ref={thinkingScrollRef}
                style={[styles.thinkingScrollView, isStreamingWithThinking && styles.thinkingScrollViewStreaming]}
                contentContainerStyle={styles.thinkingScrollContent}
                showsVerticalScrollIndicator={isStreamingWithThinking}
                nestedScrollEnabled
              >
                <Text style={styles.thinkingText}>
                  {thinking}
                  {isThinkingStreaming && <BlinkingCursor style={styles.cursor} />}
                </Text>
              </ScrollView>
            </View>
          )}
        </View>
      )}
      {visibleToolCalls.length > 0 && !isSearchStatusMessage ? (
        <View style={styles.toolCallsSection}>
          <View style={styles.toolCallsList}>
            {visibleToolCalls.map((toolCall, index) => (
              <View
                key={toolCall.id ?? `${toolCall.function.name}-${index}`}
                style={styles.toolCallBadge}
              >
                <Ionicons
                  name={getToolCallBadgeIcon(toolCall)}
                  size={13}
                  color={colors.accent}
                />
                <Text style={styles.toolCallBadgeText} numberOfLines={1}>
                  {getToolCallBadgeLabel(toolCall)}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}
      <View style={styles.assistantContent}>
        {message.isStreaming && !isThinkingStreaming && response.length === 0 ? (
          <BlinkingCursor style={styles.cursor} />
        ) : (
          <View style={styles.markdownSegments}>
            {preparedResponseSegments.map((segment, index) => {
              if (segment.type === 'code-block') {
                const codeLines = getCodeBlockLines(segment.content);

                return (
                  <View
                    key={`${MARKDOWN_RENDER_VERSION}-code-${message.id}-${index}`}
                    style={styles.codeBlockContainer}
                  >
                    <ScrollView
                      horizontal
                      nestedScrollEnabled
                      showsHorizontalScrollIndicator
                      style={styles.codeBlockScrollView}
                      contentContainerStyle={styles.codeBlockScrollContent}
                    >
                      <View style={styles.codeBlockContent}>
                        {codeLines.map((line, lineIndex) => (
                          <Text
                            key={`${MARKDOWN_RENDER_VERSION}-code-line-${message.id}-${index}-${lineIndex}`}
                            style={styles.codeBlockText}
                          >
                            {line.length > 0 ? line : ' '}
                          </Text>
                        ))}
                      </View>
                    </ScrollView>
                  </View>
                );
              }

              if (segment.type === 'markdown') {
                if (segment.content.trim().length === 0) {
                  return null;
                }

                return (
                  <EnrichedMarkdownText
                    key={`${MARKDOWN_RENDER_VERSION}-markdown-${message.id}-${index}`}
                    markdown={segment.content}
                    flavor='github'
                    markdownStyle={markdownStyles}
                    md4cFlags={MARKDOWN_FLAGS}
                    selectable={false}
                    allowTrailingMargin={false}
                    onLinkPress={({ url }) => {
                      void Linking.openURL(url);
                    }}
                  />
                );
              }

              return (
                <EnrichedMarkdownText
                  key={`${MARKDOWN_RENDER_VERSION}-latex-${message.id}-${index}`}
                  markdown={`$$\n${segment.content}\n$$`}
                  flavor='github'
                  markdownStyle={markdownStyles}
                  md4cFlags={MARKDOWN_FLAGS}
                  selectable={false}
                  allowTrailingMargin={false}
                  onLinkPress={({ url }) => {
                    void Linking.openURL(url);
                  }}
                />
              );
            })}
          </View>
        )}
      </View>
      {translationBadgeLabel.length > 0 ? (
        <View
          style={[
            styles.translationBadge,
            styles.assistantTranslationBadge,
            translationBadgeTone === 'target' && styles.translationBadgeTarget,
          ]}
        >
          <Text
            style={[
              styles.translationBadgeText,
              translationBadgeTone === 'target' && styles.translationBadgeTextTarget,
            ]}
            numberOfLines={1}
          >
            {translationBadgeLabel}
          </Text>
        </View>
      ) : null}
      {(citationBadges.length > 0 || ttsAdvisory.length > 0 || webSearchAdvisory.length > 0) && !isSearchStatusMessage ? (
        <View style={styles.citationsSection}>
          <View style={styles.citationsList}>
            {ttsAdvisory.length > 0 ? (
              <View style={styles.webSearchAdvisoryBadge}>
                <Ionicons name='alert-circle-outline' size={12} color={colors.textSecondary} />
                <Text style={styles.webSearchAdvisoryText} numberOfLines={2}>
                  {ttsAdvisory}
                </Text>
              </View>
            ) : null}
            {webSearchAdvisory.length > 0 ? (
              <View style={styles.webSearchAdvisoryBadge}>
                <Ionicons name='alert-circle-outline' size={12} color={colors.textSecondary} />
                <Text style={styles.webSearchAdvisoryText} numberOfLines={2}>
                  {webSearchAdvisory}
                </Text>
              </View>
            ) : null}
            {citationBadges.map((result) => (
              <TouchableOpacity
                key={result.id}
                style={styles.citationBadge}
                onPress={() => {
                  void Linking.openURL(result.url);
                }}
                activeOpacity={0.75}
              >
                <Text style={styles.citationBadgeText} numberOfLines={1}>
                  {getCitationSourceLabel(result)}
                </Text>
              </TouchableOpacity>
            ))}
            {hiddenCitationCount > 0 ? (
              <TouchableOpacity
                style={styles.citationOverflowBadge}
                onPress={expandCitations}
                activeOpacity={0.75}
              >
                <Text style={styles.citationOverflowText}>{`+${hiddenCitationCount}`}</Text>
              </TouchableOpacity>
            ) : null}
            {citationsExpanded && visibleCitations.length > 3 ? (
              <TouchableOpacity
                style={styles.citationOverflowBadge}
                onPress={collapseCitations}
                activeOpacity={0.75}
              >
                <Ionicons name='chevron-back' size={12} color={colors.textSecondary} />
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      ) : null}
      {showAssistantActions ? (
        <View style={styles.actionRow}>
          {showRetry && onRetry ? (
            <RetryButton disabled={retryDisabled} onPress={onRetry} />
          ) : null}
          {onSpeak && response.length > 0 ? (
            <SpeakButton
              isSpeaking={isSpeaking}
              isTTSSyncing={isTTSSyncing}
              disabled={ttsDisabled}
              onPress={() => onSpeak(message.id, response)}
            />
          ) : null}
          {response.length > 0 ? <CopyButton text={response} align="left" /> : null}
        </View>
      ) : null}
    </View>
  );
}

export const MessageBubble = memo(
  MessageBubbleComponent,
  areMessageBubblePropsEqual,
);

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    userContainer: {
      alignSelf: 'flex-end',
      alignItems: 'flex-end',
      marginTop: SPACING.md,
      marginBottom: SPACING.xs,
      marginHorizontal: SPACING.lg,
      maxWidth: '80%',
    },
    userBubble: {
      backgroundColor: colors.userBubble,
      borderRadius: RADII.lg,
      paddingHorizontal: SPACING.md + 4,
      paddingVertical: SPACING.sm + 2,
    },
    userImage: {
      width: 200,
      height: 150,
      borderRadius: RADII.md,
      marginBottom: SPACING.xs,
      alignSelf: 'flex-end',
    },
    userText: {
      fontSize: 15,
      lineHeight: 22,
      color: colors.textPrimary,
    },
    userAttachmentScroll: {
      alignSelf: 'flex-end',
      flexGrow: 0,
      flexShrink: 0,
      maxWidth: '100%',
    },
    userAttachmentRow: {
      alignItems: 'center',
      gap: SPACING.sm,
      paddingBottom: SPACING.xs,
    },
    userAttachmentChip: {
      maxWidth: 220,
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACING.xs,
      paddingHorizontal: SPACING.sm,
      paddingVertical: 6,
      borderRadius: RADII.pill,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    userAttachmentText: {
      flexShrink: 1,
      fontSize: 13,
      color: colors.textPrimary,
    },
    translationBadge: {
      maxWidth: '100%',
    },
    userTranslationBadge: {
      alignSelf: 'flex-end',
      marginTop: SPACING.xs,
    },
    assistantTranslationBadge: {
      alignSelf: 'flex-start',
      marginTop: SPACING.sm,
    },
    translationBadgeTarget: {
      alignSelf: 'flex-start',
    },
    translationBadgeText: {
      fontSize: 11,
      lineHeight: 14,
      color: colors.textSecondary,
      fontWeight: FONT.regular,
    },
    translationBadgeTextTarget: {
      color: colors.textSecondary,
    },
    assistantContainer: {
      alignSelf: 'stretch',
      marginTop: SPACING.md,
      marginBottom: SPACING.xs,
      marginHorizontal: SPACING.lg,
    },
    assistantContent: {
      // bare text on background — no bubble
    },
    markdownSegments: {
      alignSelf: 'stretch',
    },
    codeBlockContainer: {
      marginTop: SPACING.xs,
      marginBottom: SPACING.sm,
      borderRadius: RADII.sm,
      backgroundColor: colors.sidebar,
    },
    codeBlockScrollView: {
      borderRadius: RADII.sm,
    },
    codeBlockScrollContent: {
      minWidth: '100%',
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.md,
    },
    codeBlockContent: {
      alignSelf: 'flex-start',
    },
    codeBlockText: {
      color: colors.textPrimary,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 13,
      lineHeight: 20,
      textAlign: 'left',
    },
    toolCallsSection: {
      marginBottom: SPACING.sm,
    },
    toolCallsList: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: SPACING.xs,
    },
    toolCallBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      maxWidth: '100%',
      paddingVertical: 2,
      borderRadius: RADII.pill,
      gap: SPACING.xs,
    },
    toolCallBadgeText: {
      flexShrink: 1,
      fontSize: 12,
      lineHeight: 16,
      color: colors.textSecondary,
      fontWeight: FONT.regular,
    },
    citationsSection: {
      marginTop: SPACING.sm,
    },
    citationsList: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: SPACING.xs,
    },
    citationBadge: {
      maxWidth: '100%',
      paddingHorizontal: SPACING.sm,
      paddingVertical: 4,
      borderRadius: RADII.pill,
      backgroundColor: colors.accentTint,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    citationBadgeText: {
      fontSize: 11,
      lineHeight: 14,
      color: colors.accent,
      fontWeight: FONT.regular,
    },
    citationOverflowBadge: {
      paddingHorizontal: SPACING.sm,
      paddingVertical: 4,
      borderRadius: RADII.pill,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    citationOverflowText: {
      fontSize: 11,
      lineHeight: 14,
      color: colors.textSecondary,
      fontWeight: FONT.regular,
    },
    webSearchAdvisoryBadge: {
      maxWidth: '100%',
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACING.xs,
      paddingHorizontal: SPACING.sm,
      paddingVertical: 4,
      borderRadius: RADII.pill,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    webSearchAdvisoryText: {
      flexShrink: 1,
      fontSize: 11,
      lineHeight: 14,
      color: colors.textSecondary,
      fontWeight: FONT.regular,
    },
    copyButton: {
      marginTop: 2,
      padding: 4,
    },
    actionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACING.xs,
      alignSelf: 'flex-start',
      marginTop: SPACING.sm,
    },
    speakButton: {
      marginTop: 2,
      padding: 4,
      width: 23,
      height: 23,
      alignItems: 'center',
      justifyContent: 'center',
    },
    retryButton: {
      marginTop: 2,
      padding: 4,
      width: 23,
      height: 23,
      alignItems: 'center',
      justifyContent: 'center',
    },
    speakButtonInner: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    copyButtonLeft: {
      alignSelf: 'flex-start',
    },
    copyButtonRight: {
      alignSelf: 'flex-end',
    },
    thinkingWrapper: {
      marginBottom: SPACING.sm,
      paddingLeft: SPACING.md,
      borderLeftWidth: 2,
      borderLeftColor: colors.border,
    },
    thinkingHeader: {
      paddingVertical: SPACING.xs,
    },
    thinkingHeaderInner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACING.sm,
    },
    thinkingChevron: {
      fontSize: 11,
      color: colors.textTertiary,
      width: 12,
      textAlign: 'center',
    },
    thinkingLabel: {
      fontSize: 13,
      color: colors.textSecondary,
    },
    thinkingBody: {
      paddingTop: SPACING.xs,
      paddingBottom: SPACING.sm,
    },
    thinkingScrollView: {
      flexGrow: 0,
      maxHeight: 120,
    },
    thinkingScrollViewStreaming: {
      maxHeight: 52,
    },
    thinkingScrollContent: {
      paddingRight: SPACING.xs,
    },
    thinkingText: {
      fontSize: 13,
      lineHeight: 20,
      color: colors.textSecondary,
      fontStyle: 'italic',
    },
    cursor: {
      color: colors.textSecondary,
      fontSize: 15,
    },
  });
}
