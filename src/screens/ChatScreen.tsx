import React, {
  useState,
  useRef,
  useCallback,
  useContext,
  useEffect,
  useMemo,
} from "react";
import {
  Animated,
  View,
  Text,
  TextInput,
  Keyboard,
  InteractionManager,
  Pressable,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Modal,
  Alert,
  useWindowDimensions,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import {
  SafeAreaView,
  SafeAreaProvider,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import {
  MessageBubble,
  Message,
  type AssistantToolTranscript,
  type MessageAttachment,
  type ToolResultMessage,
} from "../components/MessageBubble";
import { Sidebar, ChatSummary } from "../components/Sidebar";
import { ModelPickerDropdown } from "../components/ModelPickerDropdown";
import { ChatHeader } from "../components/ChatHeader";
import { ChatInput } from "../components/ChatInput";
import { ChatEmptyState } from "../components/ChatEmptyState";
import { ModelCatalogScreen } from "../screens/ModelCatalogScreen";
import { FileVaultScreen } from "../screens/FileVaultScreen";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LlamaContext } from "../context/LlamaContext";
import { useFileRagContext } from "../context/FileRagContext";
import {
  ALL_MODELS,
  getThinkingBudgetForModel,
  getTranslationModelByPath,
  type ModelConfig,
  type ModelCatalogTab,
  type ThinkingBudget,
} from "../constants/models";
import { ColorPalette, RADII, SPACING } from "../constants/theme";
import { useTheme } from "../context/ThemeContext";
import { useVoice } from "../hooks/useVoice";
import { Ionicons } from "@expo/vector-icons";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import {
  getGenerationTokenBudget,
  type LlamaToolCall,
  type StructuredMessages,
} from "../hooks/useLlama";
import {
  mergeReasoningIntoContent,
  parseThinking,
} from "../utils/reasoning";
import { getSupportedDocumentPickerTypes } from "../utils/fileReaders";
import { analyzeTTSLanguageSupport } from "../utils/ttsText";
import {
  detectTranslationSourceLanguage,
  getDetectedTranslationLanguageLabel,
} from "../utils/translationLanguage";
import type { PickedDocumentSource, RagQueryResult, RagSource } from "../types/fileRag";
import type { WebSearchResult } from "../types/webSearch";
import { WEB_SEARCH_TOOL, runDuckDuckGoSearch } from "../utils/webSearch";
import { Agent } from "../agent/Agent";
import { webSearchTool } from "../agent/tools";
import type { AgentEvent, AgentResult } from "../agent/types";
import {
  findPreferredLoadableModelCandidate,
  findPreferredLoadableTranslationModelCandidate,
  SELECTED_MODEL_KEY,
  SELECTED_TRANSLATION_MODEL_KEY,
} from "../utils/loadableModels";
import { isModelAllowedByDeviceMemory } from "../utils/modelMemory";
import { logBootStep } from "../utils/bootTrace";

const CHATS_STORAGE_KEY = "tensorchat_chats";
const ACTIVE_CHAT_ID_KEY = "tensorchat_active_chat_id";
const ACTIVE_CHAT_MODE_KEY = "tensorchat_active_chat_mode";
const MIN_MAIN_PANE_VISIBLE = 64;
const MIN_SIDEBAR_WIDTH = 280;
const MAX_SIDEBAR_WIDTH = 360;
const RAG_QUERY_RESULT_COUNT = 16;
const RAG_CONTEXT_MAX_SECTIONS = 12;
const RAG_CONTEXT_MAX_CHARS = 12000;
const RAG_CONTEXT_TOKEN_MARGIN = 192;
const RAG_CONTEXT_MAX_RETRIEVED_TOKENS = 1200;
const RAG_CONTEXT_FALLBACK_MAX_CHARS = 4800;
const RAG_CONTEXT_MIN_PROMPT_TOKENS = 256;
const MAX_ATTACHED_SOURCES = 1;
const MAX_WEB_SEARCH_TOOL_ROUNDS = 1;
const TTS_ADVISORY_DISMISS_MS = 3000;
const WEB_SEARCH_GUIDANCE = [
  "You have access to the web_search tool for up-to-date web information.",
  "Use web_search when the user asks about current events, recent changes, live data, or facts you are not confident are still current.",
  "If the answer can be given from the conversation or attached files alone, answer directly without calling tools.",
  "After using web_search, cite the most relevant sources with Markdown links.",
].join("\n");
const WEB_SEARCH_MODEL_ADVISORY =
  "Use a bigger model for a more accurate response.";
const PROMPT_MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const PROMPT_WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function formatPromptDateTime(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const weekdayName = PROMPT_WEEKDAY_NAMES[date.getDay()];
  const monthName = PROMPT_MONTH_NAMES[date.getMonth()];
  const dayOfMonth = date.getDate();
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  const timezoneOffsetMinutes = -date.getTimezoneOffset();
  const sign = timezoneOffsetMinutes >= 0 ? "+" : "-";
  const absoluteOffsetMinutes = Math.abs(timezoneOffsetMinutes);
  const offsetHours = String(Math.floor(absoluteOffsetMinutes / 60)).padStart(2, "0");
  const offsetMinutes = String(absoluteOffsetMinutes % 60).padStart(2, "0");
  const isoDate = `${year}-${month}-${day}`;

  return `${weekdayName}, ${monthName} ${dayOfMonth}, ${year} ${hours}:${minutes}:${seconds} GMT${sign}${offsetHours}:${offsetMinutes} (ISO ${isoDate})`;
}

function nextId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// Same settings shape as private-mind (software-mansion-labs/private-mind)
interface ChatSettings {
  systemPrompt: string;
  contextWindow: number; // number of past message pairs to include
  thinkingEnabled: boolean;
  webSearchEnabled: boolean;
  agentModeEnabled: boolean;
}

const DEFAULT_SETTINGS: ChatSettings = {
  systemPrompt: "",
  contextWindow: 6,
  thinkingEnabled: false,
  webSearchEnabled: false,
  agentModeEnabled: false,
};

const DEFAULT_SYSTEM_PROMPT =
  "You are a helpful AI assistant. Be accurate, honest, and concise.";

type ChatMode = "chat" | "translation";
type ChatSelectionState = Record<ChatMode, string | null>;
type TranslationLanguageCode =
  | "auto"
  | "ar"
  | "de"
  | "en"
  | "es"
  | "fr"
  | "hi"
  | "it"
  | "ja"
  | "ko"
  | "pt"
  | "ro"
  | "ru"
  | "zh";
type TranslationTargetLanguageCode = Exclude<TranslationLanguageCode, "auto">;

interface TranslationChatSettings {
  sourceLanguage: TranslationLanguageCode;
  targetLanguage: TranslationTargetLanguageCode;
}

interface TranslationLanguagePair {
  sourceLanguage: TranslationTargetLanguageCode;
  targetLanguage: TranslationTargetLanguageCode;
}

const TRANSLATION_LANGUAGE_LABELS: Record<TranslationLanguageCode, string> = {
  auto: "Auto-detect",
  ar: "Arabic",
  de: "German",
  en: "English",
  es: "Spanish",
  fr: "French",
  hi: "Hindi",
  it: "Italian",
  ja: "Japanese",
  ko: "Korean",
  pt: "Portuguese",
  ro: "Romanian",
  ru: "Russian",
  zh: "Chinese",
};

const TRANSLATION_SOURCE_LANGUAGE_OPTIONS: TranslationLanguageCode[] = [
  "auto",
  "en",
  "es",
  "fr",
  "de",
  "it",
  "pt",
  "ro",
  "ja",
  "ko",
  "zh",
  "ar",
  "hi",
  "ru",
];

const TRANSLATION_TARGET_LANGUAGE_OPTIONS: TranslationTargetLanguageCode[] = [
  "en",
  "es",
  "fr",
  "de",
  "it",
  "pt",
  "ro",
  "ja",
  "ko",
  "zh",
  "ar",
  "hi",
  "ru",
];

const DEFAULT_TRANSLATION_SETTINGS: TranslationChatSettings = {
  sourceLanguage: "auto",
  targetLanguage: "en",
};

const DEFAULT_MODE_CHAT_SELECTION: ChatSelectionState = {
  chat: null,
  translation: null,
};

function buildFallbackTranslationLanguagePair(
  targetLanguage: TranslationTargetLanguageCode,
): TranslationLanguagePair {
  return {
    sourceLanguage: targetLanguage === "en" ? "es" : "en",
    targetLanguage,
  };
}

function getExplicitTranslationLanguagePair(
  translationSettings: TranslationChatSettings,
): TranslationLanguagePair | null {
  if (translationSettings.sourceLanguage === "auto") {
    return null;
  }

  return {
    sourceLanguage: translationSettings.sourceLanguage,
    targetLanguage: translationSettings.targetLanguage,
  };
}

function normalizeLoadedTranslationLanguagePair(
  rawPair: unknown,
  translationSettings: TranslationChatSettings,
): TranslationLanguagePair {
  const explicitPair = getExplicitTranslationLanguagePair(translationSettings);
  if (explicitPair) {
    return explicitPair;
  }

  const fallbackPair = buildFallbackTranslationLanguagePair(
    translationSettings.targetLanguage,
  );
  const partialPair =
    rawPair && typeof rawPair === "object"
      ? (rawPair as Partial<TranslationLanguagePair>)
      : undefined;
  const sourceLanguage = normalizeTranslationLanguageCode(
    partialPair?.sourceLanguage,
    fallbackPair.sourceLanguage,
  );
  const targetLanguage = normalizeTranslationLanguageCode(
    partialPair?.targetLanguage,
    fallbackPair.targetLanguage,
  );

  if (sourceLanguage === "auto" || targetLanguage === "auto") {
    return fallbackPair;
  }

  return {
    sourceLanguage,
    targetLanguage,
  };
}

function getSwappedTranslationSettings(
  translationSettings: TranslationChatSettings,
  lastTranslationPair: TranslationLanguagePair,
): TranslationLanguagePair {
  if (translationSettings.sourceLanguage !== "auto") {
    return {
      sourceLanguage: translationSettings.targetLanguage,
      targetLanguage: translationSettings.sourceLanguage,
    };
  }

  const nextTargetLanguage =
    translationSettings.targetLanguage === lastTranslationPair.targetLanguage
      ? lastTranslationPair.sourceLanguage
      : translationSettings.targetLanguage === lastTranslationPair.sourceLanguage
        ? lastTranslationPair.targetLanguage
        : lastTranslationPair.sourceLanguage !== translationSettings.targetLanguage
          ? lastTranslationPair.sourceLanguage
          : lastTranslationPair.targetLanguage;

  return {
    sourceLanguage: translationSettings.targetLanguage,
    targetLanguage: nextTargetLanguage,
  };
}

function buildTranslationMessageBadge(
  tone: "source" | "target",
  label: string,
): NonNullable<Message["translationBadge"]> {
  return {
    label,
    tone,
  };
}

function normalizeTranslationBadgeLabel(label: string): string {
  return label.replace(/^(?:source|target):\s*/i, "").trim();
}

function buildTranslationMessageBadges(
  translationSettings: TranslationChatSettings,
  sourceLanguageLabel: string,
): {
  userBadge: NonNullable<Message["translationBadge"]>;
  assistantBadge: NonNullable<Message["translationBadge"]>;
} {
  return {
    userBadge: buildTranslationMessageBadge(
      "source",
      sourceLanguageLabel,
    ),
    assistantBadge: buildTranslationMessageBadge(
      "target",
      TRANSLATION_LANGUAGE_LABELS[translationSettings.targetLanguage],
    ),
  };
}

function resolveTranslationSourceLanguageCode(
  text: string,
  translationSettings: TranslationChatSettings,
  lastTranslationPair: TranslationLanguagePair,
): TranslationTargetLanguageCode {
  if (translationSettings.sourceLanguage !== "auto") {
    return translationSettings.sourceLanguage;
  }

  return detectTranslationSourceLanguage(text, {
    fallbackLanguage: lastTranslationPair.sourceLanguage,
    targetLanguage: translationSettings.targetLanguage,
  });
}

function resolveTranslationSourceBadgeLabel(
  text: string,
  translationSettings: TranslationChatSettings,
  lastTranslationPair: TranslationLanguagePair,
): string {
  if (translationSettings.sourceLanguage !== "auto") {
    return TRANSLATION_LANGUAGE_LABELS[translationSettings.sourceLanguage];
  }

  return getDetectedTranslationLanguageLabel(
    resolveTranslationSourceLanguageCode(
      text,
      translationSettings,
      lastTranslationPair,
    ),
  );
}

interface Chat {
  id: string;
  mode: ChatMode;
  title: string;
  titleEdited: boolean;
  messages: Message[];
  // Draft file attachments selected in the composer for this chat.
  sourceIds: string[];
  settings: ChatSettings;
  translationSettings: TranslationChatSettings;
  lastTranslationPair: TranslationLanguagePair;
  createdAt: number;
}

function makeNewChat(mode: ChatMode = "chat"): Chat {
  return {
    id: nextId(),
    mode,
    title: mode === "translation" ? "New Translation" : "New Chat",
    titleEdited: false,
    messages: [],
    sourceIds: [],
    settings: { ...DEFAULT_SETTINGS },
    translationSettings: { ...DEFAULT_TRANSLATION_SETTINGS },
    lastTranslationPair: buildFallbackTranslationLanguagePair(
      DEFAULT_TRANSLATION_SETTINGS.targetLanguage,
    ),
    createdAt: Date.now(),
  };
}

function makeDefaultModeDrafts(): Record<ChatMode, Chat> {
  return {
    chat: makeNewChat("chat"),
    translation: makeNewChat("translation"),
  };
}

function isUntitledEmptyChat(chat: Chat): boolean {
  return (
    chat.messages.length === 0
    && chat.sourceIds.length === 0
    && !chat.titleEdited
  );
}

function updateChatCollectionById(
  chats: Chat[],
  chatId: string,
  updater: (chat: Chat) => Chat,
): Chat[] {
  let changed = false;

  const nextChats = chats.map((chat) => {
    if (chat.id !== chatId) {
      return chat;
    }

    const updatedChat = updater(chat);
    if (updatedChat !== chat) {
      changed = true;
    }
    return updatedChat;
  });

  return changed ? nextChats : chats;
}

function normalizeSourceIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (sourceId): sourceId is string => typeof sourceId === "string",
  ).slice(0, MAX_ATTACHED_SOURCES);
}

function normalizeLoadedMessageAttachment(
  rawAttachment: unknown,
): MessageAttachment | null {
  if (!rawAttachment || typeof rawAttachment !== "object") {
    return null;
  }

  const attachment = rawAttachment as Partial<MessageAttachment>;
  if (
    typeof attachment.sourceId !== "string"
    || typeof attachment.name !== "string"
  ) {
    return null;
  }

  return {
    sourceId: attachment.sourceId,
    name: attachment.name,
    type:
      attachment.type === "pdf"
      || attachment.type === "txt"
      || attachment.type === "md"
      || attachment.type === "html"
        ? attachment.type
        : undefined,
    size: typeof attachment.size === "number" ? attachment.size : null,
  };
}

function normalizeLoadedMessage(rawMessage: Message): Message {
  const partialMessage = rawMessage as Partial<Message>;
  const attachedSources = Array.isArray(
    partialMessage.attachedSources,
  )
    ? rawMessage.attachedSources
        ?.map(normalizeLoadedMessageAttachment)
        .filter(
          (attachment): attachment is MessageAttachment => attachment !== null,
        )
    : undefined;
  const webSearchResults = Array.isArray(partialMessage.webSearchResults)
    ? partialMessage.webSearchResults
        .map(normalizeLoadedWebSearchResult)
        .filter((result): result is WebSearchResult => result !== null)
    : undefined;
  const toolTranscript = normalizeLoadedToolTranscript(partialMessage.toolTranscript);
  const translationBadge =
    partialMessage.translationBadge
    && typeof partialMessage.translationBadge === "object"
    && typeof partialMessage.translationBadge.label === "string"
      ? {
          label: normalizeTranslationBadgeLabel(
            partialMessage.translationBadge.label,
          ),
          tone:
            partialMessage.translationBadge.tone === "target"
              ? ("target" as const)
              : ("source" as const),
        }
      : undefined;

  return {
    ...rawMessage,
    attachedSources,
    // TTS advisory is transient UI state and should not survive reload.
    ttsAdvisory: undefined,
    webSearchAdvisory:
      typeof partialMessage.webSearchAdvisory === "string"
        ? partialMessage.webSearchAdvisory
        : undefined,
    searchQuery:
      typeof partialMessage.searchQuery === "string"
        ? partialMessage.searchQuery
        : undefined,
    webSearchResults,
    toolTranscript,
    translationBadge,
  };
}

function buildMessageAttachmentSnapshot(
  sourceIds: string[],
  sources: RagSource[],
): MessageAttachment[] {
  const sourceById = new Map(sources.map((source) => [source.id, source]));

  return normalizeSourceIds(sourceIds)
    .map((sourceId) => sourceById.get(sourceId))
    .filter((source): source is RagSource => source !== undefined)
    .map((source) => ({
      sourceId: source.id,
      name: source.name,
      type: source.type,
      size: source.size,
    }));
}

function getMessageAttachmentSourceIds(
  message: Message,
  fallbackSourceIds: string[],
): string[] {
  if (Array.isArray(message.attachedSources)) {
    return normalizeSourceIds(
      message.attachedSources
        .map((attachment) => attachment.sourceId)
        .filter((sourceId): sourceId is string => typeof sourceId === "string"),
    );
  }

  return fallbackSourceIds;
}

function normalizeLoadedChatSettings(
  rawSettings: Partial<ChatSettings> | undefined,
): ChatSettings {
  const contextWindow =
    typeof rawSettings?.contextWindow === "number"
      ? Math.max(1, Math.floor(rawSettings.contextWindow))
      : DEFAULT_SETTINGS.contextWindow;

  return {
    systemPrompt:
      typeof rawSettings?.systemPrompt === "string"
        ? rawSettings.systemPrompt
        : DEFAULT_SETTINGS.systemPrompt,
    contextWindow,
    thinkingEnabled:
      typeof rawSettings?.thinkingEnabled === "boolean"
        ? rawSettings.thinkingEnabled
        : DEFAULT_SETTINGS.thinkingEnabled,
    webSearchEnabled:
      typeof rawSettings?.webSearchEnabled === "boolean"
        ? rawSettings.webSearchEnabled
        : DEFAULT_SETTINGS.webSearchEnabled,
    agentModeEnabled:
      typeof rawSettings?.agentModeEnabled === "boolean"
        ? rawSettings.agentModeEnabled
        : DEFAULT_SETTINGS.agentModeEnabled,
  };
}

function normalizeTranslationLanguageCode(
  value: unknown,
  fallback: TranslationLanguageCode,
): TranslationLanguageCode {
  return typeof value === "string" && value in TRANSLATION_LANGUAGE_LABELS
    ? (value as TranslationLanguageCode)
    : fallback;
}

function normalizeLoadedTranslationSettings(
  rawSettings: unknown,
): TranslationChatSettings {
  const partialSettings =
    rawSettings && typeof rawSettings === "object"
      ? (rawSettings as Partial<TranslationChatSettings>)
      : undefined;
  const sourceLanguage = normalizeTranslationLanguageCode(
    partialSettings?.sourceLanguage,
    DEFAULT_TRANSLATION_SETTINGS.sourceLanguage,
  );
  const targetLanguageCandidate = normalizeTranslationLanguageCode(
    partialSettings?.targetLanguage,
    DEFAULT_TRANSLATION_SETTINGS.targetLanguage,
  );

  return {
    sourceLanguage,
    targetLanguage:
      targetLanguageCandidate === "auto"
        ? DEFAULT_TRANSLATION_SETTINGS.targetLanguage
        : targetLanguageCandidate,
  };
}

function normalizeLoadedWebSearchResult(rawResult: unknown): WebSearchResult | null {
  if (!rawResult || typeof rawResult !== "object") {
    return null;
  }

  const result = rawResult as Partial<WebSearchResult>;
  if (
    typeof result.id !== "string"
    || typeof result.title !== "string"
    || typeof result.url !== "string"
    || typeof result.source !== "string"
    || typeof result.snippet !== "string"
  ) {
    return null;
  }

  return {
    id: result.id,
    title: result.title,
    url: result.url,
    source: result.source,
    snippet: result.snippet,
  };
}

function normalizeLoadedToolCall(rawToolCall: unknown): LlamaToolCall | null {
  if (!rawToolCall || typeof rawToolCall !== "object") {
    return null;
  }

  const toolCall = rawToolCall as Partial<LlamaToolCall>;
  if (
    toolCall.type !== "function"
    || !toolCall.function
    || typeof toolCall.function.name !== "string"
    || typeof toolCall.function.arguments !== "string"
  ) {
    return null;
  }

  return {
    type: "function",
    ...(typeof toolCall.id === "string" ? { id: toolCall.id } : {}),
    function: {
      name: toolCall.function.name,
      arguments: toolCall.function.arguments,
    },
  };
}

function normalizeLoadedToolResult(rawToolResult: unknown): ToolResultMessage | null {
  if (!rawToolResult || typeof rawToolResult !== "object") {
    return null;
  }

  const toolResult = rawToolResult as Partial<ToolResultMessage>;
  if (
    typeof toolResult.toolCallId !== "string"
    || typeof toolResult.toolName !== "string"
    || typeof toolResult.content !== "string"
  ) {
    return null;
  }

  return {
    toolCallId: toolResult.toolCallId,
    toolName: toolResult.toolName,
    content: toolResult.content,
    isError:
      typeof toolResult.isError === "boolean"
        ? toolResult.isError
        : undefined,
  };
}

function normalizeLoadedToolTranscript(
  rawTranscript: unknown,
): AssistantToolTranscript | undefined {
  if (!rawTranscript || typeof rawTranscript !== "object") {
    return undefined;
  }

  const transcript = rawTranscript as Partial<AssistantToolTranscript>;
  if (
    typeof transcript.content !== "string"
    || !Array.isArray(transcript.toolCalls)
    || !Array.isArray(transcript.toolResults)
  ) {
    return undefined;
  }

  const toolCalls = transcript.toolCalls
    .map(normalizeLoadedToolCall)
    .filter((toolCall): toolCall is LlamaToolCall => toolCall !== null);
  const toolResults = transcript.toolResults
    .map(normalizeLoadedToolResult)
    .filter((toolResult): toolResult is ToolResultMessage => toolResult !== null);

  if (toolCalls.length === 0 || toolResults.length === 0) {
    return undefined;
  }

  return {
    content: transcript.content,
    toolCalls,
    toolResults,
  };
}

function getEffectiveSystemPrompt(
  settings: ChatSettings,
  thinkingBudget?: ThinkingBudget,
  includeWebSearchGuidance = false,
  promptDateTime?: string,
): string {
  const systemContent = settings.systemPrompt.trim() || DEFAULT_SYSTEM_PROMPT;
  const extraGuidance: string[] = [];

  if (settings.thinkingEnabled && thinkingBudget?.promptGuidance) {
    extraGuidance.push(thinkingBudget.promptGuidance);
  }

  if (promptDateTime) {
    extraGuidance.push(`Current local date and time: ${promptDateTime}.`);
  }

  if (includeWebSearchGuidance) {
    extraGuidance.push(WEB_SEARCH_GUIDANCE);
  }

  return extraGuidance.length > 0
    ? `${systemContent}\n\n${extraGuidance.join("\n")}`
    : systemContent;
}

function buildUserTurnContent(
  newUserText: string,
  retrievedContext?: string,
): string {
  return retrievedContext
    ? `${retrievedContext}\n\nUser question:\n${newUserText.trim()}`
    : newUserText.trim();
}

function buildAssistantHistoryMessages(
  message: Message,
  modelAlwaysThinks?: boolean,
): StructuredMessages {
  const parsedMessage = parseThinking(message.content);
  const assistantHistory: StructuredMessages = [];

  if (message.toolTranscript) {
    if (modelAlwaysThinks) {
      // Reconstruct tool call markup inline for the LFM template format.
      let toolCallMarkup = "";
      try {
        toolCallMarkup = message.toolTranscript.toolCalls
          .map((tc) => {
            const args = JSON.parse(tc.function.arguments);
            const argParts = Object.entries(args)
              .map(([k, v]) => typeof v === "string" ? `${k}="${v}"` : `${k}=${v}`)
              .join(", ");
            return `<|tool_call_start|>[${tc.function.name}(${argParts})]<|tool_call_end|>`;
          })
          .join("");
      } catch { /* use empty markup if args can't be parsed */ }
      assistantHistory.push({
        role: "assistant",
        content: toolCallMarkup + (message.toolTranscript.content || ""),
      });
      assistantHistory.push(
        ...message.toolTranscript.toolResults.map((toolResult) => ({
          role: "tool" as const,
          content: toolResult.content,
        })),
      );
    } else {
      assistantHistory.push({
        role: "assistant",
        content: message.toolTranscript.content,
        tool_calls: message.toolTranscript.toolCalls,
      });
      assistantHistory.push(
        ...message.toolTranscript.toolResults.map((toolResult) => ({
          role: "tool" as const,
          content: toolResult.content,
          tool_call_id: toolResult.toolCallId,
        })),
      );
    }
  }

  if (parsedMessage.response.length > 0 || parsedMessage.thinking) {
    assistantHistory.push({
      role: "assistant",
      content: parsedMessage.response,
      ...(parsedMessage.thinking
        ? { reasoning_content: parsedMessage.thinking }
        : {}),
    });
  }

  return assistantHistory;
}

function buildPrompt(
  messages: Message[],
  newUserText: string,
  settings: ChatSettings,
  retrievedContext?: string,
  thinkingBudget?: ThinkingBudget,
  promptDateTime?: string,
  modelSupportsThinking?: boolean,
): string {
  const effectiveSystemContent = getEffectiveSystemPrompt(
    settings,
    thinkingBudget,
    false,
    promptDateTime,
  );

  // Limit history to the last contextWindow message pairs (private-mind default: 6)
  const historyMessages = messages.slice(-(settings.contextWindow * 2));
  const history = historyMessages
    .map((m) => {
      const role = m.role === "user" ? "user" : "assistant";
      const text =
        role === "assistant"
          ? m.content
              .replace(/<\s*think\s*>[\s\S]*?<\s*\/\s*think\s*>/gi, "")
              .trim()
          : m.content;
      return `<|im_start|>${role}\n${text}<|im_end|>`;
    })
    .join("\n");

  const userContent = buildUserTurnContent(newUserText, retrievedContext);

  const thinkingSuffix = modelSupportsThinking === false
    ? ""
    : settings.thinkingEnabled
      ? "<think>\n"
      : "<think>\n\n</think>\n";

  return (
    `<|im_start|>system\n${effectiveSystemContent}<|im_end|>\n` +
    `${history}\n<|im_start|>user\n${userContent}<|im_end|>\n<|im_start|>assistant\n` +
    thinkingSuffix
  );
}

// Resize image so neither side exceeds 512px, then encode as base64 JPEG data URL.
async function compressImageToBase64(
  uri: string,
  srcWidth: number,
  srcHeight: number,
): Promise<string> {
  const MAX_SIDE = 512;
  const scale = Math.min(MAX_SIDE / srcWidth, MAX_SIDE / srcHeight, 1);
  const targetW = Math.round(srcWidth * scale);
  const targetH = Math.round(srcHeight * scale);
  const result = await manipulateAsync(
    uri,
    [{ resize: { width: targetW, height: targetH } }],
    { compress: 0.7, format: SaveFormat.JPEG, base64: true },
  );
  if (!result.base64)
    throw new Error("Image compression failed: no base64 output");
  return "data:image/jpeg;base64," + result.base64;
}

// Build structured messages array for multi-modal (vision) inference.
// Uses the OpenAI messages API format supported by llama.rn.
function buildMessages(
  messages: Message[],
  newUserText: string,
  settings: ChatSettings,
  imageUri: string,
  retrievedContext?: string,
  promptDateTime?: string,
): StructuredMessages {
  const systemContent = getEffectiveSystemPrompt(
    settings,
    undefined,
    false,
    promptDateTime,
  );

  // Cap history to 2 pairs for vision requests — image embeddings consume many tokens
  const historyMessages = messages.slice(
    -(Math.min(settings.contextWindow, 2) * 2),
  );
  const history: StructuredMessages = historyMessages.map((m) => {
    const role = m.role === "user" ? "user" : "assistant";
    const text =
      role === "assistant"
        ? m.content
            .replace(/<\s*think\s*>[\s\S]*?<\s*\/\s*think\s*>/gi, "")
            .trim()
        : m.content;
    return { role, content: text };
  });

  // User content: text + image
  const userText = buildUserTurnContent(newUserText, retrievedContext);
  const userContent: StructuredMessages[number]["content"] = [
    ...(userText
      ? [{ type: "text" as const, text: userText }]
      : []),
    { type: "image_url" as const, image_url: { url: imageUri } },
  ];

  return [
    { role: "system", content: systemContent },
    ...history,
    { role: "user", content: userContent },
  ];
}

function buildToolEnabledMessages(
  messages: Message[],
  newUserText: string,
  settings: ChatSettings,
  retrievedContext?: string,
  thinkingBudget?: ThinkingBudget,
  currentToolTranscript?: AssistantToolTranscript,
  promptDateTime?: string,
  modelAlwaysThinks?: boolean,
  tools?: ReadonlyArray<{ type: string; function: { name: string; description: string; parameters: object } }>,
  directSearchContext?: string,
): StructuredMessages {
  const historyMessages = messages.slice(-(settings.contextWindow * 2));
  const history: StructuredMessages = historyMessages.flatMap((message) => {
    if (message.role === "user") {
      const content = message.content.trim().length > 0
        ? message.content
        : message.imageUri
          ? "[Image attachment]"
          : "";

      return [{
        role: "user" as const,
        content,
      }];
    }

    return buildAssistantHistoryMessages(message, modelAlwaysThinks);
  });

  let systemContent = getEffectiveSystemPrompt(settings, thinkingBudget, true, promptDateTime);

  if (modelAlwaysThinks && !directSearchContext && tools && tools.length > 0 && !currentToolTranscript) {
    // Only embed tool definitions when NOT using direct search.
    // Use the documented LFM format: "List of tools: {json}"
    const toolDefs = JSON.stringify(tools.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters,
    })));
    systemContent += `\nList of tools: ${toolDefs}\n`
      + "Do not include sources, citations, or reference links in your response — they are displayed separately.";
  }
  if (modelAlwaysThinks && directSearchContext) {
    systemContent += "\nDo not include sources, citations, or reference links in your response — they are displayed separately.";
  }

  // For direct search (alwaysThinks models), append search results to the
  // user message so the model answers in a single turn without tool calling.
  let userContent = buildUserTurnContent(newUserText, retrievedContext);
  if (directSearchContext) {
    userContent += `\n\nWeb search results:\n${directSearchContext}`;
  }

  const structuredMessages: StructuredMessages = [
    {
      role: "system",
      content: systemContent,
    },
    ...history,
    {
      role: "user",
      content: userContent,
    },
  ];

  if (currentToolTranscript) {
    if (modelAlwaysThinks) {
      // For alwaysThinks models, reconstruct the assistant message with the
      // tool call markup inline (matching LFM's native format) and use the
      // standard role:"tool" for results — the LFM jinja template supports it.
      const toolCallMarkup = currentToolTranscript.toolCalls
        .map((tc) => {
          const args = JSON.parse(tc.function.arguments);
          const argParts = Object.entries(args)
            .map(([k, v]) => typeof v === "string" ? `${k}="${v}"` : `${k}=${v}`)
            .join(", ");
          return `<|tool_call_start|>[${tc.function.name}(${argParts})]<|tool_call_end|>`;
        })
        .join("");
      structuredMessages.push({
        role: "assistant",
        content: toolCallMarkup + (currentToolTranscript.content || ""),
      });
      structuredMessages.push(
        ...currentToolTranscript.toolResults.map((toolResult) => ({
          role: "tool" as const,
          content: toolResult.content,
        })),
      );
    } else {
      structuredMessages.push({
        role: "assistant",
        content: currentToolTranscript.content,
        tool_calls: currentToolTranscript.toolCalls,
      });
      structuredMessages.push(
        ...currentToolTranscript.toolResults.map((toolResult) => ({
          role: "tool" as const,
          content: toolResult.content,
          tool_call_id: toolResult.toolCallId,
        })),
      );
    }
  }

  return structuredMessages;
}

function buildAssistantRequest({
  messages,
  newUserText,
  settings,
  thinkingBudget,
  imageUri,
  retrievedContext,
  currentToolTranscript,
  promptDateTime,
  modelSupportsThinking,
  modelAlwaysThinks,
  modelNativeReasoning,
  tools,
  directSearchContext,
}: {
  messages: Message[];
  newUserText: string;
  settings: ChatSettings;
  thinkingBudget?: ThinkingBudget;
  imageUri?: string | null;
  retrievedContext?: string;
  currentToolTranscript?: AssistantToolTranscript;
  promptDateTime?: string;
  modelSupportsThinking?: boolean;
  modelAlwaysThinks?: boolean;
  modelNativeReasoning?: boolean;
  tools?: ReadonlyArray<{ type: string; function: { name: string; description: string; parameters: object } }>;
  directSearchContext?: string;
}): {
  promptOrMessages: string | StructuredMessages;
  isVisionRequest: boolean;
} {
  const isVisionRequest = typeof imageUri === "string";
  const useWebSearchMessages = settings.webSearchEnabled && !isVisionRequest;
  // Models with nativeReasoning (e.g. Gemma 4) must always use structured
  // messages so the Jinja2 template is applied. The buildPrompt() path uses
  // hardcoded ChatML format that these models don't understand.
  const useStructuredMessages = modelNativeReasoning || useWebSearchMessages;

  return {
    promptOrMessages: isVisionRequest
      ? buildMessages(
          messages,
          newUserText,
          settings,
          imageUri,
          retrievedContext,
          promptDateTime,
        )
      : useStructuredMessages
        ? buildToolEnabledMessages(
            messages,
            newUserText,
            settings,
            retrievedContext,
            thinkingBudget,
            currentToolTranscript,
            promptDateTime,
            modelAlwaysThinks,
            tools,
            directSearchContext,
          )
        : buildPrompt(
            messages,
            newUserText,
            settings,
            retrievedContext,
            thinkingBudget,
            promptDateTime,
            modelSupportsThinking,
          ),
    isVisionRequest,
  };
}

function buildTranslationPrompt({
  newUserText,
  translationSettings,
  translationModel,
}: {
  newUserText: string;
  translationSettings: TranslationChatSettings;
  translationModel?: Pick<ModelConfig, "filename" | "huggingFaceRepo"> | null;
}): string {
  const isTranslateGemmaTranslationModel =
    !!translationModel
    && (
      translationModel.filename.includes("translategemma-4b-it")
      || translationModel.huggingFaceRepo.includes("translategemma-4b-it")
    );
  const isEuroLlmTranslationModel =
    !!translationModel
    && (
      translationModel.filename.includes("EuroLLM-1.7B-Instruct")
      || translationModel.huggingFaceRepo.includes("EuroLLM-1.7B-Instruct")
    );
  const sourceCode = translationSettings.sourceLanguage.replaceAll("_", "-");
  const targetCode = translationSettings.targetLanguage.replaceAll("_", "-");
  const sourceLabel = TRANSLATION_LANGUAGE_LABELS[translationSettings.sourceLanguage];
  const targetLabel = TRANSLATION_LANGUAGE_LABELS[translationSettings.targetLanguage];
  const formatTranslationUserRequest = (text: string): string => {
    const trimmedText = text.trim();
    if (isEuroLlmTranslationModel) {
      if (translationSettings.sourceLanguage === "auto") {
        return [
          `Translate the following source text to ${targetLabel}:`,
          `Source text: ${trimmedText}`,
          `${targetLabel}:`,
        ].join("\n");
      }

      return [
        `Translate the following ${sourceLabel} source text to ${targetLabel}:`,
        `${sourceLabel}: ${trimmedText}`,
        `${targetLabel}:`,
      ].join("\n");
    }

    if (isTranslateGemmaTranslationModel) {
      if (translationSettings.sourceLanguage === "auto") {
        return [
          `You are a professional translator into ${targetLabel} (${targetCode}). Your goal is to accurately convey the meaning and nuances of the original source text while adhering to ${targetLabel} grammar, vocabulary, and cultural sensitivities.`,
          `Produce only the ${targetLabel} translation, without any additional explanations or commentary. Detect the source language and translate the following text into ${targetLabel}:`,
          "",
          "",
          trimmedText,
        ].join("\n");
      }

      return [
        `You are a professional ${sourceLabel} (${sourceCode}) to ${targetLabel} (${targetCode}) translator. Your goal is to accurately convey the meaning and nuances of the original ${sourceLabel} text while adhering to ${targetLabel} grammar, vocabulary, and cultural sensitivities.`,
        `Produce only the ${targetLabel} translation, without any additional explanations or commentary. Please translate the following ${sourceLabel} text into ${targetLabel}:`,
        "",
        "",
        trimmedText,
      ].join("\n");
    }

    return [
      `Translate from ${sourceLabel} to ${targetLabel}.`,
      translationSettings.sourceLanguage === "auto"
        ? "Detect the source language from the text before translating."
        : null,
      "Output only the translated text.",
      "Do not explain the translation or add commentary.",
      "Preserve tone, formatting, and names where possible.",
      "",
      trimmedText,
    ]
      .filter((item): item is string => item !== null)
      .join("\n");
  };
  const turnStart = isEuroLlmTranslationModel ? "<|im_start|>" : "<start_of_turn>";
  const turnEnd = isEuroLlmTranslationModel ? "<|im_end|>" : "<end_of_turn>";
  const assistantRole = isEuroLlmTranslationModel ? "assistant" : "model";

  return [
    isTranslateGemmaTranslationModel ? "<bos>" : null,
    `${turnStart}user\n${formatTranslationUserRequest(newUserText)}${turnEnd}`,
    `${turnStart}${assistantRole}\n`,
  ]
    .filter((section): section is string => !!section && section.trim().length > 0)
    .join("\n");
}

function getTranslationStopTokens(
  translationModel?: Pick<ModelConfig, "filename" | "huggingFaceRepo"> | null,
): string[] {
  const isEuroLlmTranslationModel =
    !!translationModel
    && (
      translationModel.filename.includes("EuroLLM-1.7B-Instruct")
      || translationModel.huggingFaceRepo.includes("EuroLLM-1.7B-Instruct")
    );

  return isEuroLlmTranslationModel ? ["<|im_end|>"] : ["<end_of_turn>"];
}

function hasAssistantResponse(responseContent: string): boolean {
  return responseContent.trim().length > 0;
}

function normalizeLoadedChat(rawChat: Chat): Chat {
  const partialChat = rawChat as Partial<Chat>;
  const translationSettings = normalizeLoadedTranslationSettings(
    partialChat.translationSettings,
  );
  const lastTranslationPair = normalizeLoadedTranslationLanguagePair(
    partialChat.lastTranslationPair,
    translationSettings,
  );
  const messages = Array.isArray(rawChat.messages)
    ? rawChat.messages.map(normalizeLoadedMessage).map((message) => {
        if (
          partialChat.mode !== "translation"
          || message.role !== "user"
        ) {
          return message;
        }

        const normalizedBadgeLabel = normalizeTranslationBadgeLabel(
          message.translationBadge?.label ?? "",
        );
        if (
          normalizedBadgeLabel.length > 0
          && normalizedBadgeLabel !== TRANSLATION_LANGUAGE_LABELS.auto
        ) {
          return message;
        }

        return {
          ...message,
          translationBadge: {
            label: resolveTranslationSourceBadgeLabel(
              message.content,
              translationSettings,
              lastTranslationPair,
            ),
            tone: "source" as const,
          },
        };
      })
    : [];

  return {
    ...rawChat,
    mode:
      partialChat.mode === "translation"
        ? "translation"
        : "chat",
    titleEdited: typeof partialChat.titleEdited === "boolean"
      ? partialChat.titleEdited as boolean
      : false,
    messages,
    sourceIds: normalizeSourceIds(partialChat.sourceIds),
    settings: normalizeLoadedChatSettings(partialChat.settings),
    translationSettings,
    lastTranslationPair,
  };
}

function resolveStartupChats(
  rawChats: Chat[],
  rawActiveId: string | null,
  rawActiveMode: string | null,
): {
  chats: Chat[];
  selectedChatIdsByMode: ChatSelectionState;
  activeMode: ChatMode;
} {
  const parsedChats = rawChats.map(normalizeLoadedChat);
  const selectedChatIdsByMode: ChatSelectionState = {
    ...DEFAULT_MODE_CHAT_SELECTION,
  };
  const savedActiveChat = rawActiveId
    ? parsedChats.find((chat) => chat.id === rawActiveId) ?? null
    : null;
  const preferredStartupMode: ChatMode =
    rawActiveMode === "translation" ? "translation" : "chat";

  if (savedActiveChat) {
    selectedChatIdsByMode[savedActiveChat.mode] = savedActiveChat.id;
    return {
      chats: parsedChats,
      selectedChatIdsByMode,
      activeMode: savedActiveChat.mode,
    };
  }

  const preferredModeChat = parsedChats.find(
    (chat) => chat.mode === preferredStartupMode,
  ) ?? null;

  if (rawActiveMode === "chat" || rawActiveMode === "translation") {
    if (preferredModeChat) {
      selectedChatIdsByMode[preferredStartupMode] = preferredModeChat.id;
    }

    return {
      chats: parsedChats,
      selectedChatIdsByMode,
      activeMode: preferredStartupMode,
    };
  }

  const fallbackChat = preferredModeChat ?? parsedChats[0] ?? null;
  if (fallbackChat) {
    selectedChatIdsByMode[fallbackChat.mode] = fallbackChat.id;
  }

  return {
    chats: parsedChats,
    selectedChatIdsByMode,
    activeMode: fallbackChat?.mode ?? "chat",
  };
}

function buildToolErrorContent(query: string, error: string): string {
  return JSON.stringify({
    query,
    results: [],
    error,
  });
}

function dedupeWebSearchResults(results: WebSearchResult[]): WebSearchResult[] {
  const deduped = new Map<string, WebSearchResult>();
  results.forEach((result) => {
    if (!deduped.has(result.url)) {
      deduped.set(result.url, result);
    }
  });
  return Array.from(deduped.values());
}

function tryNormalizeToolArguments(argumentsText: string): string | null {
  const trimmedArguments = argumentsText.trim();

  if (!trimmedArguments) {
    return JSON.stringify({});
  }

  try {
    return JSON.stringify(JSON.parse(trimmedArguments));
  } catch {
    return null;
  }
}

function getNormalizedToolCallKey(toolCall: Pick<LlamaToolCall, "function">): string {
  return `${toolCall.function.name}:${toolCall.function.arguments.trim()}`;
}

function normalizeAssistantToolCalls(toolCalls: LlamaToolCall[]): LlamaToolCall[] {
  const deduped = new Map<string, LlamaToolCall>();

  toolCalls.forEach((toolCall, index) => {
    const normalizedArguments = tryNormalizeToolArguments(
      toolCall.function.arguments,
    );

    if (normalizedArguments === null) {
      console.warn("[TensorChat] dropping malformed tool call arguments:", {
        id: toolCall.id,
        name: toolCall.function.name,
        arguments: toolCall.function.arguments,
      });
      return;
    }

    const normalizedToolCall = {
      ...toolCall,
      id: toolCall.id ?? `tool-call-${index}-${nextId()}`,
      function: {
        ...toolCall.function,
        arguments: normalizedArguments,
      },
    };
    const key = getNormalizedToolCallKey(normalizedToolCall);
    deduped.set(key, normalizedToolCall);
  });

  return Array.from(deduped.values());
}

async function executeWebSearchToolCalls(
  toolCalls: LlamaToolCall[],
  fallbackQuery?: string,
): Promise<{
  searchQuery?: string;
  toolCalls: LlamaToolCall[];
  toolResults: ToolResultMessage[];
  webSearchResults: WebSearchResult[];
}> {
  const normalizedToolCalls = normalizeAssistantToolCalls(toolCalls);
  const toolResults: ToolResultMessage[] = [];
  const webSearchResults: WebSearchResult[] = [];
  const queries: string[] = [];

  for (const toolCall of normalizedToolCalls) {
    if (toolCall.function.name !== "web_search") {
      toolResults.push({
        toolCallId: toolCall.id!,
        toolName: toolCall.function.name,
        content: buildToolErrorContent(
          "",
          `Unsupported tool requested: ${toolCall.function.name}`,
        ),
        isError: true,
      });
      continue;
    }

    let parsedArguments: unknown;

    try {
      parsedArguments = JSON.parse(toolCall.function.arguments);
    } catch {
      toolResults.push({
        toolCallId: toolCall.id!,
        toolName: toolCall.function.name,
        content: buildToolErrorContent(
          "",
          "Tool arguments were not valid JSON.",
        ),
        isError: true,
      });
      continue;
    }

    // LFM models may use alternative parameter names (e.g. "search" instead
    // of "query", "max_result" instead of "max_results") since their tool
    // calls are free-text rather than grammar-constrained.
    const args = parsedArguments && typeof parsedArguments === "object"
      ? parsedArguments as Record<string, unknown>
      : {} as Record<string, unknown>;
    const query = (
      typeof args.query === "string" ? args.query
      : typeof args.search === "string" ? args.search
      : typeof args.search_query === "string" ? args.search_query
      : ""
    ).trim();
    const maxResults =
      typeof args.max_results === "number" ? args.max_results
      : typeof args.max_result === "number" ? args.max_result
      : typeof args.num_results === "number" ? args.num_results
      : undefined;

    // If the model omitted the query (e.g. LFM generating only max_results),
    // fall back to using the user's original message as the search query.
    const effectiveQuery = query || (fallbackQuery ?? "").trim();
    if (!effectiveQuery) {
      toolResults.push({
        toolCallId: toolCall.id!,
        toolName: toolCall.function.name,
        content: buildToolErrorContent(
          "",
          "The web_search tool requires a non-empty query.",
        ),
        isError: true,
      });
      continue;
    }

    // Update tool call arguments to include the effective query so the UI
    // badge shows what was actually searched (e.g. "Search: latest news Iran")
    // instead of just "Search" when the model omitted the query param.
    if (!query && effectiveQuery) {
      try {
        const updatedArgs = { ...args, query: effectiveQuery };
        toolCall.function.arguments = JSON.stringify(updatedArgs);
      } catch { /* keep original arguments */ }
    }

    const searchResult = await runDuckDuckGoSearch(effectiveQuery, maxResults);
    queries.push(searchResult.query);
    webSearchResults.push(...searchResult.results);
    toolResults.push({
      toolCallId: toolCall.id!,
      toolName: toolCall.function.name,
      content: searchResult.serializedContent,
      isError: !!searchResult.error && searchResult.results.length === 0,
    });
  }

  return {
    searchQuery:
      queries.length === 0
        ? undefined
        : queries.length === 1
          ? queries[0]
          : queries.join(" | "),
    toolCalls: normalizedToolCalls,
    toolResults,
    webSearchResults: dedupeWebSearchResults(webSearchResults),
  };
}

function buildWebSearchStatusText(searchQuery?: string): string {
  return searchQuery
    ? `Searching for \"${searchQuery}\"...`
    : "Searching ...";
}

function buildRetrievedContextSections(results: RagQueryResult[]): string[] {
  const seenSections = new Set<string>();
  const sections: string[] = [];
  let combinedLength = 0;

  for (const item of results) {
    const rawSection = item.document?.trim() ?? "";
    if (!rawSection || seenSections.has(rawSection)) {
      continue;
    }

    const remainingLength =
      RAG_CONTEXT_MAX_CHARS - combinedLength - (sections.length > 0 ? 2 : 0);
    if (remainingLength <= 0) {
      break;
    }

    const section = rawSection.slice(0, remainingLength).trim();
    if (!section) {
      break;
    }

    seenSections.add(rawSection);
    sections.push(section);
    combinedLength += section.length + (sections.length > 1 ? 2 : 0);

    if (sections.length >= RAG_CONTEXT_MAX_SECTIONS) {
      break;
    }
  }

  return sections;
}

function joinRetrievedContextSections(sections: string[]): string | null {
  return sections.length > 0 ? sections.join("\n\n") : null;
}

function fitRetrievedContextSectionsToCharLimit(
  sections: string[],
  maxChars: number,
): string[] {
  const fittedSections: string[] = [];
  let combinedLength = 0;

  for (const rawSection of sections) {
    const remainingLength =
      maxChars - combinedLength - (fittedSections.length > 0 ? 2 : 0);
    if (remainingLength <= 0) {
      break;
    }

    const section = rawSection.slice(0, remainingLength).trim();
    if (!section) {
      break;
    }

    fittedSections.push(section);
    combinedLength += section.length + (fittedSections.length > 1 ? 2 : 0);
  }

  return fittedSections;
}

async function fitRetrievedContextToBudget({
  candidateSections,
  maxPromptTokens,
  maxRetrievedContextTokens,
  countPromptTokens,
}: {
  candidateSections: string[];
  maxPromptTokens: number;
  maxRetrievedContextTokens: number;
  countPromptTokens: (retrievedContext?: string) => Promise<number | null>;
}): Promise<{
  basePromptTokenCount: number | null;
  retrievedContext?: string;
  promptTokenCount: number | null;
  retrievedContextTokenCount: number | null;
  sectionsUsed: number;
  usedFallback: boolean;
  wasTrimmed: boolean;
}> {
  const fullCandidateContext =
    joinRetrievedContextSections(candidateSections) ?? undefined;
  const fallbackSections = fitRetrievedContextSectionsToCharLimit(
    candidateSections,
    RAG_CONTEXT_FALLBACK_MAX_CHARS,
  );
  const fallbackContext = joinRetrievedContextSections(fallbackSections) ?? undefined;

  if (candidateSections.length === 0) {
    return {
      basePromptTokenCount: null,
      retrievedContext: undefined,
      promptTokenCount: null,
      retrievedContextTokenCount: null,
      sectionsUsed: 0,
      usedFallback: false,
      wasTrimmed: false,
    };
  }

  const basePromptTokenCount = await countPromptTokens(undefined);
  if (basePromptTokenCount === null) {
    return {
      basePromptTokenCount: null,
      retrievedContext: fallbackContext,
      promptTokenCount: null,
      retrievedContextTokenCount: null,
      sectionsUsed: fallbackSections.length,
      usedFallback: true,
      wasTrimmed: fallbackContext !== fullCandidateContext,
    };
  }

  if (basePromptTokenCount > maxPromptTokens) {
    return {
      basePromptTokenCount,
      retrievedContext: undefined,
      promptTokenCount: basePromptTokenCount,
      retrievedContextTokenCount: 0,
      sectionsUsed: 0,
      usedFallback: false,
      wasTrimmed: candidateSections.length > 0,
    };
  }

  let bestContext: string | undefined;
  let bestPromptTokenCount = basePromptTokenCount;
  let bestRetrievedContextTokenCount = 0;
  let sectionsUsed = 0;

  for (let index = 0; index < candidateSections.length; index += 1) {
    const nextContext = joinRetrievedContextSections(
      candidateSections.slice(0, index + 1),
    );
    if (!nextContext) {
      break;
    }

    const promptTokenCount = await countPromptTokens(nextContext);
    if (promptTokenCount === null) {
      return {
        basePromptTokenCount: null,
        retrievedContext: fallbackContext,
        promptTokenCount: null,
        retrievedContextTokenCount: null,
        sectionsUsed: fallbackSections.length,
        usedFallback: true,
        wasTrimmed: fallbackContext !== fullCandidateContext,
      };
    }

    const retrievedContextTokenCount = Math.max(
      0,
      promptTokenCount - basePromptTokenCount,
    );

    if (
      promptTokenCount > maxPromptTokens
      || retrievedContextTokenCount > maxRetrievedContextTokens
    ) {
      break;
    }

    bestContext = nextContext;
    bestPromptTokenCount = promptTokenCount;
    bestRetrievedContextTokenCount = retrievedContextTokenCount;
    sectionsUsed = index + 1;
  }

  return {
    basePromptTokenCount,
    retrievedContext: bestContext,
    promptTokenCount: bestPromptTokenCount,
    retrievedContextTokenCount: bestRetrievedContextTokenCount,
    sectionsUsed,
    usedFallback: false,
    wasTrimmed: bestContext !== fullCandidateContext,
  };
}

function buildRetrievedContextBlock(results: RagQueryResult[]): string | null {
  return joinRetrievedContextSections(buildRetrievedContextSections(results));
}

export function ChatScreen({
  appReady,
  startupAutoloadPending,
}: {
  appReady: boolean;
  startupAutoloadPending: boolean;
}): React.JSX.Element {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const {
    loadModel,
    loadedModelPath,
    loadedContextSize,
    isLoading,
    isGenerating,
    generateResponse,
    countPromptTokens,
    error,
    stopGeneration: stopLlamaGeneration,
    loadedTranslationModelPath,
    isTranslationLoading,
    loadTranslationModel,
    generateTranslation,
    translationError,
    stopTranslationGeneration,
  } = useContext(LlamaContext);
  const llamaContext = useContext(LlamaContext);
  const llamaContextRef = useRef(llamaContext);
  llamaContextRef.current = llamaContext;
  const {
    sources,
    isHydrated: fileRagHydrated,
    isEmbeddingModelEnabled,
    isEmbeddingModelDownloaded,
    isBusy: isFileRagBusy,
    statusMessage: fileRagStatusMessage,
    error: fileRagError,
    clearError: clearFileRagError,
    indexDocument,
    deleteSource,
    querySources,
  } = useFileRagContext();
  const {
    isAvailable: voiceAvailable,
    progress: voiceProgress,
    error: voiceError,
    getVoiceModelStatus,
    startRecording,
    stopRecordingAndTranscribe,
    pauseAndTranscribe,
    pauseRecording,
    cancelRecording,
    speakText,
    stopSpeaking,
    clearError: clearVoiceError,
  } = useVoice();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const sidebarWidth = Math.min(
    MAX_SIDEBAR_WIDTH,
    Math.max(MIN_SIDEBAR_WIDTH, windowWidth - MIN_MAIN_PANE_VISIBLE),
  );

  const initialModeDrafts = useRef<Record<ChatMode, Chat>>(
    makeDefaultModeDrafts(),
  );
  const [modeDrafts, setModeDrafts] = useState<Record<ChatMode, Chat>>(
    initialModeDrafts.current,
  );
  const [chats, setChats] = useState<Chat[]>([]);
  const [selectedChatIdsByMode, setSelectedChatIdsByMode] =
    useState<ChatSelectionState>(DEFAULT_MODE_CHAT_SELECTION);
  const [activeMode, setActiveMode] = useState<ChatMode>("chat");
  const [incognitoChat, setIncognitoChat] = useState<Chat | null>(null);
  const [chatsLoaded, setChatsLoaded] = useState(false);

  // Load persisted chats on mount
  useEffect(() => {
    async function loadChats() {
      try {
        const [rawChats, rawActiveId, rawActiveMode] = await Promise.all([
          AsyncStorage.getItem(CHATS_STORAGE_KEY),
          AsyncStorage.getItem(ACTIVE_CHAT_ID_KEY),
          AsyncStorage.getItem(ACTIVE_CHAT_MODE_KEY),
        ]);
        if (rawChats) {
          const parsed = JSON.parse(rawChats) as Chat[];
          const startupState = resolveStartupChats(
            parsed,
            rawActiveId,
            rawActiveMode,
          );
          setChats(startupState.chats);
          setSelectedChatIdsByMode(startupState.selectedChatIdsByMode);
          setActiveMode(startupState.activeMode);
        } else if (rawActiveMode === "chat" || rawActiveMode === "translation") {
          setActiveMode(rawActiveMode);
        }
      } catch (err) {
        console.warn("[TensorChat] Failed to load chats:", err);
      } finally {
        setChatsLoaded(true);
      }
    }
    loadChats();
  }, []);

  // Persist chats whenever they change (debounced, skip before initial load)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!chatsLoaded) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      AsyncStorage.setItem(CHATS_STORAGE_KEY, JSON.stringify(chats)).catch(
        (err) => console.warn("[TensorChat] Failed to save chats:", err),
      );
    }, 500);
  }, [chats, chatsLoaded]);

  useEffect(() => {
    setSelectedChatIdsByMode((prev) => {
      const next: ChatSelectionState = {
        chat:
          prev.chat
          && chats.some((chat) => chat.id === prev.chat && chat.mode === "chat")
            ? prev.chat
            : null,
        translation:
          prev.translation
          && chats.some(
            (chat) =>
              chat.id === prev.translation && chat.mode === "translation",
          )
            ? prev.translation
            : null,
      };

      return next.chat === prev.chat && next.translation === prev.translation
        ? prev
        : next;
    });
  }, [chats]);

  // Persist the last non-incognito active mode whenever it changes.
  useEffect(() => {
    if (!chatsLoaded) return;
    if (incognitoChat !== null) return;

    AsyncStorage.setItem(ACTIVE_CHAT_MODE_KEY, activeMode).catch((err) =>
      console.warn("[TensorChat] Failed to save active chat mode:", err),
    );
  }, [activeMode, chatsLoaded, incognitoChat]);

  // Persist the active saved chat id for the current mode whenever it changes.
  useEffect(() => {
    if (!chatsLoaded) return;
    if (incognitoChat !== null) return;

    const activeSavedChatId = selectedChatIdsByMode[activeMode];
    const writeActiveChatId = activeSavedChatId
      ? AsyncStorage.setItem(ACTIVE_CHAT_ID_KEY, activeSavedChatId)
      : AsyncStorage.removeItem(ACTIVE_CHAT_ID_KEY);

    writeActiveChatId.catch((err) =>
      console.warn("[TensorChat] Failed to save active chat id:", err),
    );
  }, [activeMode, chatsLoaded, incognitoChat, selectedChatIdsByMode]);
  const [inputText, setInputText] = useState("");
  const inputRef = useRef<TextInput>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [renameChatId, setRenameChatId] = useState<string | null>(null);
  const [renameDraftTitle, setRenameDraftTitle] = useState("");
  const [modelCatalogVisible, setModelCatalogVisible] = useState(false);
  const [fileVaultVisible, setFileVaultVisible] = useState(false);
  const catalogInitialTabRef = useRef<ModelCatalogTab>("0.8B");
  const pendingModelCatalogOpenTaskRef = useRef<ReturnType<typeof InteractionManager.runAfterInteractions> | null>(null);
  const pendingFileVaultOpenTaskRef = useRef<ReturnType<typeof InteractionManager.runAfterInteractions> | null>(null);
  const [modelPickerVisible, setModelPickerVisible] = useState(false);
  const [translationLanguagePicker, setTranslationLanguagePicker] = useState<
    "source" | "target" | null
  >(null);
  const [translationLanguageListCanScrollDown, setTranslationLanguageListCanScrollDown] = useState(false);
  const [pendingImageUri, setPendingImageUri] = useState<string | null>(null);
  const [pendingImageDisplayUri, setPendingImageDisplayUri] = useState<
    string | null
  >(null);
  const [isCompressingImage, setIsCompressingImage] = useState(false);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const attachMenuAnim = useRef(new Animated.Value(0)).current;
  const modelPillRef = useRef<View>(null);
  const chevronAnim = useRef(new Animated.Value(0)).current;
  const translationLanguageListMetricsRef = useRef({
    contentHeight: 0,
    layoutHeight: 0,
    offsetY: 0,
  });
  const drawerTranslateX = useRef(new Animated.Value(0)).current;
  const flatListRef = useRef<FlatList<Message>>(null);
  const pendingScrollFrameRef = useRef<number | null>(null);
  // Tracks whether the list is scrolled to (or near) the bottom.
  // Use a ref so streaming callbacks and onFocus always read the live value
  // without causing re-renders.
  const isAtBottomRef = useRef(true);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const contentHeightRef = useRef(0);
  const layoutHeightRef = useRef(0);
  const streamFlushRef = useRef<number | null>(null);
  const inputClearFrameRef = useRef<number | null>(null);
  const manualStopRequestedRef = useRef(false);
  const [voiceModelsDownloaded, setVoiceModelsDownloaded] = useState(false);
  const [modelInventoryVersion, setModelInventoryVersion] = useState(0);
  const [pendingModeModelLoad, setPendingModeModelLoad] = useState<
    ChatMode | null
  >(null);
  const chatAutoLoadAttemptRef = useRef<string | null>(null);
  const translationAutoLoadAttemptRef = useRef<string | null>(null);

  useEffect(() => {
    logBootStep('Chat screen mounted');
  }, []);

  useEffect(() => {
    if (chatsLoaded) {
      logBootStep('Chat state hydrated');
    }
  }, [chatsLoaded]);

  useEffect(() => {
    if (appReady) {
      logBootStep('Chat screen observed appReady');
    }
  }, [appReady]);

  useEffect(() => {
    if (startupAutoloadPending) {
      logBootStep('Chat screen waiting for startup autoload');
    }
  }, [startupAutoloadPending]);

  const bumpModelInventoryVersion = useCallback(() => {
    setModelInventoryVersion((current) => current + 1);
  }, []);
  const isChatModelLoading = isLoading || startupAutoloadPending;

  useEffect(() => {
    if (loadedModelPath) {
      const modelName = loadedModelPath.split('/').pop() ?? loadedModelPath;
      logBootStep(`Chat screen sees loaded model: ${modelName}`);
      chatAutoLoadAttemptRef.current = null;
      setPendingModeModelLoad((current) =>
        current === "chat" ? null : current,
      );
    }
  }, [loadedModelPath]);

  useEffect(() => {
    if (!loadedTranslationModelPath) {
      return;
    }

    const modelName =
      loadedTranslationModelPath.split("/").pop() ?? loadedTranslationModelPath;
    logBootStep(`Chat screen sees loaded translation model: ${modelName}`);
    translationAutoLoadAttemptRef.current = null;
    setPendingModeModelLoad((current) =>
      current === "translation" ? null : current,
    );
  }, [loadedTranslationModelPath]);

  useEffect(() => {
    if (
      !appReady
      || startupAutoloadPending
      || isLoading
      || isTranslationLoading
      || isGenerating
    ) {
      return;
    }

    let cancelled = false;

    async function ensureActiveModeModel() {
      const clearPendingModeLoad = (mode: ChatMode) => {
        if (!cancelled) {
          setPendingModeModelLoad((current) =>
            current === mode ? null : current,
          );
        }
      };

      const currentActiveChatMode: ChatMode = activeMode;

      if (currentActiveChatMode === "translation") {
        if (loadedTranslationModelPath) {
          translationAutoLoadAttemptRef.current = null;
          clearPendingModeLoad("translation");
          return;
        }

        setPendingModeModelLoad("translation");
        const savedTranslationId = await AsyncStorage.getItem(
          SELECTED_TRANSLATION_MODEL_KEY,
        );
        const candidate = await findPreferredLoadableTranslationModelCandidate(
          savedTranslationId,
          {
            isModelEligible: isModelAllowedByDeviceMemory,
          },
        );
        if (!candidate) {
          translationAutoLoadAttemptRef.current = null;
          clearPendingModeLoad("translation");
          return;
        }

        const attemptKey = `${modelInventoryVersion}:${candidate.model.id}`;
        if (translationAutoLoadAttemptRef.current === attemptKey) {
          clearPendingModeLoad("translation");
          return;
        }

        translationAutoLoadAttemptRef.current = attemptKey;

        try {
          await AsyncStorage.setItem(
            SELECTED_TRANSLATION_MODEL_KEY,
            candidate.model.id,
          );
          if (cancelled) {
            return;
          }
          await loadTranslationModel(candidate.modelPath);
        } catch (err) {
          console.warn(
            "[ChatScreen] Failed to auto-load translation model:",
            err,
          );
        } finally {
          clearPendingModeLoad("translation");
        }
        return;
      }

      if (loadedModelPath) {
        chatAutoLoadAttemptRef.current = null;
        clearPendingModeLoad("chat");
        return;
      }

      setPendingModeModelLoad("chat");

      try {
        const savedId = await AsyncStorage.getItem(SELECTED_MODEL_KEY);
        const candidate = await findPreferredLoadableModelCandidate(savedId, {
          isModelEligible: isModelAllowedByDeviceMemory,
        });
        if (!candidate) {
          chatAutoLoadAttemptRef.current = null;
          clearPendingModeLoad("chat");
          return;
        }

        const attemptKey = `${modelInventoryVersion}:${candidate.model.id}`;
        if (chatAutoLoadAttemptRef.current === attemptKey) {
          clearPendingModeLoad("chat");
          return;
        }

        chatAutoLoadAttemptRef.current = attemptKey;

        await AsyncStorage.setItem(SELECTED_MODEL_KEY, candidate.model.id);
        if (cancelled) {
          return;
        }
        await loadModel(candidate.modelPath, candidate.mmprojPath);
      } catch (err) {
        console.warn("[ChatScreen] Failed to auto-load downloaded model:", err);
      } finally {
        clearPendingModeLoad("chat");
      }
    }

    ensureActiveModeModel();

    return () => {
      cancelled = true;
    };
  }, [
    activeMode,
    appReady,
    isGenerating,
    isLoading,
    isTranslationLoading,
    loadModel,
    loadedModelPath,
    loadedTranslationModelPath,
    loadTranslationModel,
    modelInventoryVersion,
    startupAutoloadPending,
  ]);

  useEffect(() => {
    Animated.timing(drawerTranslateX, {
      toValue: sidebarOpen ? sidebarWidth : 0,
      duration: sidebarOpen ? 250 : 220,
      useNativeDriver: true,
    }).start();
  }, [drawerTranslateX, sidebarOpen, sidebarWidth]);
  const [voiceModeEnabled, setVoiceModeEnabled] = useState(false);
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [isRecordingPaused, setIsRecordingPaused] = useState(false);
  const [isTranscribingVoice, setIsTranscribingVoice] = useState(false);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(
    null,
  );
  const speakingMessageIdRef = useRef<string | null>(null);
  const ttsAdvisoryTimeoutsRef = useRef(
    new Map<string, ReturnType<typeof setTimeout>>(),
  );

  const getTTSAdvisoryTimerKey = useCallback(
    (chatId: string, messageId: string) => `${chatId}:${messageId}`,
    [],
  );

  const clearMessageTTSAdvisoryTimeout = useCallback(
    (chatId: string, messageId: string) => {
      const timerKey = getTTSAdvisoryTimerKey(chatId, messageId);
      const existingTimer = ttsAdvisoryTimeoutsRef.current.get(timerKey);

      if (!existingTimer) {
        return;
      }

      clearTimeout(existingTimer);
      ttsAdvisoryTimeoutsRef.current.delete(timerKey);
    },
    [getTTSAdvisoryTimerKey],
  );

  useEffect(() => () => {
    for (const timer of ttsAdvisoryTimeoutsRef.current.values()) {
      clearTimeout(timer);
    }
    ttsAdvisoryTimeoutsRef.current.clear();
  }, []);

  // Check whether voice models are downloaded on mount.
  useEffect(() => {
    getVoiceModelStatus()
      .then((s) => setVoiceModelsDownloaded(s.sttDownloaded && s.ttsDownloaded))
      .catch(() => setVoiceModelsDownloaded(false));
  }, [getVoiceModelStatus]);

  useEffect(() => {
    Animated.timing(chevronAnim, {
      toValue: modelPickerVisible ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [modelPickerVisible, chevronAnim]);

  const updateTranslationLanguageListScrollHint = useCallback(
    (
      nextMetrics: Partial<typeof translationLanguageListMetricsRef.current>,
    ) => {
      translationLanguageListMetricsRef.current = {
        ...translationLanguageListMetricsRef.current,
        ...nextMetrics,
      };

      const { contentHeight, layoutHeight, offsetY } =
        translationLanguageListMetricsRef.current;
      const canScrollDown =
        contentHeight > 0
        && layoutHeight > 0
        && contentHeight - layoutHeight - offsetY > 8;

      setTranslationLanguageListCanScrollDown((current) =>
        current === canScrollDown ? current : canScrollDown
      );
    },
    [],
  );

  useEffect(() => {
    if (translationLanguagePicker !== null) {
      return;
    }

    translationLanguageListMetricsRef.current = {
      contentHeight: 0,
      layoutHeight: 0,
      offsetY: 0,
    };
    setTranslationLanguageListCanScrollDown(false);
  }, [translationLanguagePicker]);

  // Refs keep chat actions stable while the active assistant row streams.
  const activePersistedChatId = selectedChatIdsByMode[activeMode];
  const activePersistedChat = activePersistedChatId
    ? chats.find(
      (chat) => chat.id === activePersistedChatId && chat.mode === activeMode,
    ) ?? null
    : null;
  const isIncognitoActive =
    incognitoChat !== null && incognitoChat.mode === activeMode;
  const activeChat =
    isIncognitoActive && incognitoChat !== null
      ? incognitoChat
      : activePersistedChat ?? modeDrafts[activeMode];
  const activeChatId = activeChat.id;
  const activeChatIdRef = useRef(activeChatId);
  activeChatIdRef.current = activeChatId;
  const chatsRef = useRef(chats);
  chatsRef.current = chats;
  const modeDraftsRef = useRef(modeDrafts);
  modeDraftsRef.current = modeDrafts;
  const selectedChatIdsByModeRef = useRef(selectedChatIdsByMode);
  selectedChatIdsByModeRef.current = selectedChatIdsByMode;
  const incognitoChatRef = useRef(incognitoChat);
  incognitoChatRef.current = incognitoChat;

  const activeChatMode: ChatMode = activeMode;
  const isTranslationMode = activeChatMode === "translation";
  const messages = activeChat.messages;
  const chatSettings = activeChat.settings;
  const translationSettings = activeChat.translationSettings;
  const lastTranslationPair = activeChat.lastTranslationPair;
  const reasoningEnabled = chatSettings.thinkingEnabled;
  const webSearchEnabled = chatSettings.webSearchEnabled;
  const draftSourceIds = activeChat.sourceIds;
  const effectiveSourceIds = isEmbeddingModelEnabled ? draftSourceIds : [];
  const activeLoadedModelPath = isTranslationMode
    ? loadedTranslationModelPath
    : loadedModelPath;
  const activeError = isTranslationMode ? translationError : error;
  const isModelLoading = isTranslationMode
    ? isTranslationLoading || pendingModeModelLoad === "translation"
    : isChatModelLoading || pendingModeModelLoad === "chat";
  const activeChatRef = useRef(activeChat);
  activeChatRef.current = activeChat;
  const activeChatModeRef = useRef(activeChatMode);
  activeChatModeRef.current = activeChatMode;
  const isTranslationModeRef = useRef(isTranslationMode);
  isTranslationModeRef.current = isTranslationMode;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const chatSettingsRef = useRef(chatSettings);
  chatSettingsRef.current = chatSettings;
  const translationSettingsRef = useRef(translationSettings);
  translationSettingsRef.current = translationSettings;
  const lastTranslationPairRef = useRef(lastTranslationPair);
  lastTranslationPairRef.current = lastTranslationPair;
  const draftSourceIdsRef = useRef(draftSourceIds);
  draftSourceIdsRef.current = draftSourceIds;
  const effectiveSourceIdsRef = useRef(effectiveSourceIds);
  effectiveSourceIdsRef.current = effectiveSourceIds;
  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;
  const activeLoadedModelPathRef = useRef(activeLoadedModelPath);
  activeLoadedModelPathRef.current = activeLoadedModelPath;

  const setSelectedChatIdForMode = useCallback(
    (mode: ChatMode, chatId: string | null) => {
      setSelectedChatIdsByMode((prev) =>
        prev[mode] === chatId ? prev : { ...prev, [mode]: chatId }
      );
    },
    [],
  );

  const discardIncognitoSession = useCallback(() => {
    setIncognitoChat((current) => (current === null ? current : null));
  }, []);

  const updateSessionById = useCallback(
    (chatId: string, updater: (chat: Chat) => Chat) => {
      const currentIncognitoChat = incognitoChatRef.current;
      if (currentIncognitoChat?.id === chatId) {
        setIncognitoChat((current) =>
          current && current.id === chatId ? updater(current) : current
        );
        return;
      }

      const currentModeDrafts = modeDraftsRef.current;
      if (
        currentModeDrafts.chat.id === chatId
        || currentModeDrafts.translation.id === chatId
      ) {
        setModeDrafts((prev) => {
          let changed = false;
          const nextDrafts = { ...prev };

          (Object.keys(prev) as ChatMode[]).forEach((mode) => {
            if (prev[mode].id !== chatId) {
              return;
            }

            const updatedChat = updater(prev[mode]);
            if (updatedChat !== prev[mode]) {
              nextDrafts[mode] = updatedChat;
              changed = true;
            }
          });

          return changed ? nextDrafts : prev;
        });
        return;
      }

      setChats((prev) => updateChatCollectionById(prev, chatId, updater));
    },
    [],
  );

  const updateActiveSession = useCallback(
    (updater: (chat: Chat) => Chat) => {
      updateSessionById(activeChatIdRef.current, updater);
    },
    [updateSessionById],
  );

  const materializeModeDraftChat = useCallback(
    (mode: ChatMode, updater: (chat: Chat) => Chat): Chat => {
      const draftChat = modeDraftsRef.current[mode];
      const savedChat = updater(draftChat);

      setChats((prev) => [savedChat, ...prev]);
      setSelectedChatIdForMode(mode, savedChat.id);
      setModeDrafts((prev) => ({
        ...prev,
        [mode]: makeNewChat(mode),
      }));

      return savedChat;
    },
    [setSelectedChatIdForMode],
  );

  useEffect(() => {
    if (!fileRagHydrated) {
      return;
    }

    const knownSourceIds = new Set(sources.map((source) => source.id));
    const normalizeChatSourceIds = (chat: Chat): Chat => {
      const nextSourceIds = chat.sourceIds
        .filter((sourceId) => knownSourceIds.has(sourceId))
        .slice(0, MAX_ATTACHED_SOURCES);

      return nextSourceIds.length === chat.sourceIds.length
        ? chat
        : { ...chat, sourceIds: nextSourceIds };
    };

    setChats((prev) => {
      let changed = false;
      const nextChats = prev.map((chat) => {
        const nextChat = normalizeChatSourceIds(chat);
        if (nextChat !== chat) {
          changed = true;
        }
        return nextChat;
      });

      return changed ? nextChats : prev;
    });

    setModeDrafts((prev) => {
      let changed = false;
      const nextDrafts = { ...prev };

      (Object.keys(prev) as ChatMode[]).forEach((mode) => {
        const nextDraft = normalizeChatSourceIds(prev[mode]);
        if (nextDraft !== prev[mode]) {
          nextDrafts[mode] = nextDraft;
          changed = true;
        }
      });

      return changed ? nextDrafts : prev;
    });

    setIncognitoChat((current) => {
      if (!current) {
        return current;
      }

      const nextChat = normalizeChatSourceIds(current);
      return nextChat === current ? current : nextChat;
    });
  }, [fileRagHydrated, sources]);

  const handleStopGeneration = useCallback(async () => {
    manualStopRequestedRef.current = true;
    if (isTranslationMode) {
      await stopTranslationGeneration();
      return;
    }

    await stopLlamaGeneration();
  }, [isTranslationMode, stopLlamaGeneration, stopTranslationGeneration]);

  const scheduleScrollToEnd = useCallback((animated: boolean) => {
    if (pendingScrollFrameRef.current !== null) {
      cancelAnimationFrame(pendingScrollFrameRef.current);
    }
    pendingScrollFrameRef.current = requestAnimationFrame(() => {
      const offset = Math.max(
        0,
        contentHeightRef.current - layoutHeightRef.current + 60,
      );
      flatListRef.current?.scrollToOffset({ offset, animated });
      pendingScrollFrameRef.current = null;
    });
  }, []);

  useEffect(() => {
    return () => {
      if (pendingScrollFrameRef.current !== null) {
        cancelAnimationFrame(pendingScrollFrameRef.current);
      }
      if (inputClearFrameRef.current !== null) {
        cancelAnimationFrame(inputClearFrameRef.current);
      }
    };
  }, []);

  // Jump to the bottom of the newly-selected chat (instant, no animation).
  // Also resets isAtBottomRef so the content-change handler kicks back in.
  useEffect(() => {
    isAtBottomRef.current = true;
    setIsAtBottom(true);
    scheduleScrollToEnd(false);
  }, [activeChatId, scheduleScrollToEnd]);

  const toggleReasoning = useCallback(() => {
    if (webSearchEnabled) {
      return;
    }

    updateActiveSession((chat) => ({
      ...chat,
      settings: {
        ...chat.settings,
        thinkingEnabled: !chat.settings.thinkingEnabled,
      },
    }));
  }, [updateActiveSession, webSearchEnabled]);

  const toggleWebSearch = useCallback(() => {
    updateActiveSession((chat) => {
      const nextWebSearch = !chat.settings.webSearchEnabled;
      return {
        ...chat,
        settings: {
          ...chat.settings,
          webSearchEnabled: nextWebSearch,
          // Web search ON → enable agent mode for multi-step search.
          // Web search OFF → disable agent mode too.
          agentModeEnabled: nextWebSearch,
          thinkingEnabled: nextWebSearch
            ? false
            : chat.settings.thinkingEnabled,
        },
      };
    });
  }, [updateActiveSession]);

  const toggleAgentMode = useCallback(() => {
    updateActiveSession((chat) => {
      const nextAgentMode = !chat.settings.agentModeEnabled;
      return {
        ...chat,
        settings: {
          ...chat.settings,
          agentModeEnabled: nextAgentMode,
          // Agent mode enables web search automatically and disables
          // standalone thinking (the agent handles thinking internally).
          webSearchEnabled: nextAgentMode ? true : chat.settings.webSearchEnabled,
          thinkingEnabled: nextAgentMode ? false : chat.settings.thinkingEnabled,
        },
      };
    });
  }, [updateActiveSession]);

  const loadedModel = loadedModelPath
    ? (ALL_MODELS.find((m) => loadedModelPath.endsWith(m.filename)) ?? null)
    : null;
  const loadedTranslationModel = getTranslationModelByPath(
    loadedTranslationModelPath,
  );
  const thinkingBudget = useMemo(
    () => getThinkingBudgetForModel(loadedModel),
    [loadedModel],
  );
  const loadedModelName = isTranslationMode
    ? (loadedTranslationModel?.name ?? null)
    : (loadedModel?.name ?? (loadedModelPath ? "Unknown model" : null));
  const modelSupportsThinking = isTranslationMode
    ? false
    : (loadedModel?.supportsThinking ?? false);
  const modelSupportsVision = isTranslationMode
    ? false
    : (loadedModel?.isVisionModel ?? false);
  const modelSupportsWebSearch = isTranslationMode
    ? false
    : (loadedModel?.supportsToolCalling ?? false);
  const modelAlwaysThinks = loadedModel?.alwaysThinks ?? false;
  const modelNativeReasoning = loadedModel?.nativeReasoning ?? false;
  const isPreparingVoice =
    voiceProgress?.model !== "tts" &&
    (voiceProgress?.stage === "initializing" ||
      voiceProgress?.stage === "downloading" ||
      voiceProgress?.stage === "loading");
  const isTTSSyncing =
    !!voiceProgress &&
    voiceProgress.model === "tts" &&
    (voiceProgress.stage === "loading" ||
      voiceProgress.stage === "synthesizing");
  const voiceStatusText = voiceError
    ? `Voice error: ${voiceError}`
    : voiceProgress?.model === "tts"
      ? null
      : (voiceProgress?.message ?? null);

  const openAttachMenu = useCallback(() => {
    if (isTranslationMode || !activeLoadedModelPath) return;
    setAttachMenuOpen(true);
    Animated.spring(attachMenuAnim, {
      toValue: 1,
      useNativeDriver: true,
      tension: 180,
      friction: 12,
    }).start();
  }, [activeLoadedModelPath, attachMenuAnim, isTranslationMode]);

  const closeAttachMenu = useCallback(() => {
    Animated.timing(attachMenuAnim, {
      toValue: 0,
      duration: 120,
      useNativeDriver: true,
    }).start(() => setAttachMenuOpen(false));
  }, [attachMenuAnim]);

  useEffect(() => {
    if (!activeLoadedModelPath && attachMenuOpen) {
      closeAttachMenu();
    }
  }, [activeLoadedModelPath, attachMenuOpen, closeAttachMenu]);

  const openSidebar = useCallback(() => {
    if (attachMenuOpen) {
      closeAttachMenu();
    }
    if (modelPickerVisible) {
      setModelPickerVisible(false);
    }
    inputRef.current?.blur();
    setSidebarOpen(true);
  }, [attachMenuOpen, closeAttachMenu, modelPickerVisible]);

  const closeSidebar = useCallback(() => {
    setSidebarOpen(false);
  }, []);

  const syncVoiceModelDownloadState = useCallback(() => {
    getVoiceModelStatus()
      .then((status) =>
        setVoiceModelsDownloaded(status.sttDownloaded && status.ttsDownloaded),
      )
      .catch(() => {});
  }, [getVoiceModelStatus]);

  const closeFileVault = useCallback(() => {
    pendingFileVaultOpenTaskRef.current?.cancel();
    pendingFileVaultOpenTaskRef.current = null;
    setFileVaultVisible(false);
  }, []);

  const closeModelCatalog = useCallback(() => {
    pendingFileVaultOpenTaskRef.current?.cancel();
    pendingFileVaultOpenTaskRef.current = null;
    pendingModelCatalogOpenTaskRef.current?.cancel();
    pendingModelCatalogOpenTaskRef.current = null;
    catalogInitialTabRef.current = "0.8B";
    setModelCatalogVisible(false);
    syncVoiceModelDownloadState();
  }, [syncVoiceModelDownloadState]);

  const openModelCatalog = useCallback(
    (initialTab: ModelCatalogTab = "0.8B") => {
      catalogInitialTabRef.current = initialTab;

      if (modelCatalogVisible) {
        return;
      }

      pendingFileVaultOpenTaskRef.current?.cancel();
      pendingFileVaultOpenTaskRef.current = null;
      pendingModelCatalogOpenTaskRef.current?.cancel();
      pendingModelCatalogOpenTaskRef.current = null;

      if (attachMenuOpen) {
        closeAttachMenu();
      }

      if (modelPickerVisible) {
        setModelPickerVisible(false);
      }

      if (sidebarOpen) {
        setSidebarOpen(false);
      }

      Keyboard.dismiss();
      inputRef.current?.blur();

      pendingModelCatalogOpenTaskRef.current = InteractionManager.runAfterInteractions(() => {
        pendingModelCatalogOpenTaskRef.current = null;
        setModelCatalogVisible(true);
      });
    },
    [
      attachMenuOpen,
      closeAttachMenu,
      modelCatalogVisible,
      modelPickerVisible,
      sidebarOpen,
    ],
  );

  const openFileVault = useCallback(() => {
    if (fileVaultVisible) {
      return;
    }

    pendingModelCatalogOpenTaskRef.current?.cancel();
    pendingModelCatalogOpenTaskRef.current = null;
    pendingFileVaultOpenTaskRef.current?.cancel();
    pendingFileVaultOpenTaskRef.current = null;

    if (attachMenuOpen) {
      closeAttachMenu();
    }

    if (modelPickerVisible) {
      setModelPickerVisible(false);
    }

    if (sidebarOpen) {
      setSidebarOpen(false);
    }

    Keyboard.dismiss();
    inputRef.current?.blur();

    pendingFileVaultOpenTaskRef.current = InteractionManager.runAfterInteractions(() => {
      pendingFileVaultOpenTaskRef.current = null;
      setFileVaultVisible(true);
    });
  }, [attachMenuOpen, closeAttachMenu, fileVaultVisible, modelPickerVisible, sidebarOpen]);

  useEffect(() => {
    return () => {
      pendingFileVaultOpenTaskRef.current?.cancel();
      pendingFileVaultOpenTaskRef.current = null;
      pendingModelCatalogOpenTaskRef.current?.cancel();
      pendingModelCatalogOpenTaskRef.current = null;
    };
  }, []);

  const closeRenameModal = useCallback(() => {
    Keyboard.dismiss();
    setRenameChatId(null);
    setRenameDraftTitle("");
  }, []);

  const openRenameModal = useCallback(
    (chatId: string) => {
      const chat = chatsRef.current.find((candidate) => candidate.id === chatId);
      if (!chat) {
        return;
      }

      inputRef.current?.blur();
      setRenameChatId(chatId);
      setRenameDraftTitle(chat.title);
    },
    [],
  );

  const submitRenameChat = useCallback(() => {
    const nextTitle = renameDraftTitle.trim();
    if (!renameChatId || nextTitle.length === 0) {
      return;
    }

    setChats((prev) =>
      prev.map((chat) =>
        chat.id === renameChatId
          ? {
              ...chat,
              title: nextTitle,
              titleEdited: true,
            }
          : chat,
      ),
    );
    closeRenameModal();
  }, [closeRenameModal, renameChatId, renameDraftTitle]);

  const attachSourceToChat = useCallback((chatId: string, sourceId: string) => {
    updateSessionById(chatId, (chat) =>
      chat.sourceIds.includes(sourceId) || chat.sourceIds.length >= MAX_ATTACHED_SOURCES
        ? chat
        : { ...chat, sourceIds: [sourceId] }
    );
  }, [updateSessionById]);

  const detachSourceFromChat = useCallback((chatId: string, sourceId: string) => {
    updateSessionById(chatId, (chat) => ({
      ...chat,
      sourceIds: chat.sourceIds.filter((candidate) => candidate !== sourceId),
    }));
  }, [updateSessionById]);

  const removeSourceFromAllChats = useCallback((sourceId: string) => {
    setChats((prev) => {
      let changed = false;
      const nextChats = prev.map((chat) => {
        if (!chat.sourceIds.includes(sourceId)) {
          return chat;
        }

        changed = true;
        return {
          ...chat,
          sourceIds: chat.sourceIds.filter((candidate) => candidate !== sourceId),
        };
      });

      return changed ? nextChats : prev;
    });
    setModeDrafts((prev) => {
      let changed = false;
      const nextDrafts = { ...prev };

      (Object.keys(prev) as ChatMode[]).forEach((mode) => {
        if (!prev[mode].sourceIds.includes(sourceId)) {
          return;
        }

        nextDrafts[mode] = {
          ...prev[mode],
          sourceIds: prev[mode].sourceIds.filter(
            (candidate) => candidate !== sourceId,
          ),
        };
        changed = true;
      });

      return changed ? nextDrafts : prev;
    });
    setIncognitoChat((current) => {
      if (!current || !current.sourceIds.includes(sourceId)) {
        return current;
      }

      return {
        ...current,
        sourceIds: current.sourceIds.filter((candidate) => candidate !== sourceId),
      };
    });
  }, []);

  const toggleSourceForActiveChat = useCallback(
    (sourceId: string) => {
      const chatId = activeChatIdRef.current;
      const targetChat = chatsRef.current.find((chat) => chat.id === chatId);
      if (!targetChat) {
        return;
      }

      if (targetChat.sourceIds.includes(sourceId)) {
        detachSourceFromChat(chatId, sourceId);
        return;
      }

      attachSourceToChat(chatId, sourceId);
    },
    [attachSourceToChat, detachSourceFromChat],
  );

  const settleNativePickerPresentation = useCallback(async () => {
    inputRef.current?.blur();
    Keyboard.dismiss();
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 75);
    });
  }, []);

  const importDocumentSource = useCallback(
    async (attachToCurrentChat: boolean) => {
      await settleNativePickerPresentation();

      const result = await DocumentPicker.getDocumentAsync({
        type: getSupportedDocumentPickerTypes(),
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (result.canceled || !result.assets[0]) {
        return;
      }

      const asset = result.assets[0];
      const pickedDocument: PickedDocumentSource = {
        uri: asset.uri,
        name: asset.name || asset.uri.split("/").pop() || "Unnamed",
        size: asset.size ?? null,
        mimeType: asset.mimeType,
      };

      const indexed = await indexDocument(pickedDocument);
      if (attachToCurrentChat) {
        attachSourceToChat(activeChatIdRef.current, indexed.source.id);
      }
    },
    [attachSourceToChat, indexDocument, settleNativePickerPresentation],
  );

  const handlePickDocument = useCallback(() => {
    openFileVault();
  }, [openFileVault]);

  const handleUploadToFileVault = useCallback(async () => {
    try {
      await importDocumentSource(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      Alert.alert("File import failed", message);
    }
  }, [importDocumentSource]);

  const handleDeleteIndexedSource = useCallback(
    async (sourceId: string) => {
      try {
        await deleteSource(sourceId);
        removeSourceFromAllChats(sourceId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        Alert.alert("Delete failed", message);
      }
    },
    [deleteSource, removeSourceFromAllChats],
  );

  const pickFromCamera = useCallback(async () => {
    closeAttachMenu();
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return;
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      quality: 1,
    });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      setPendingImageDisplayUri(asset.uri);
      setIsCompressingImage(true);
      try {
        const dataUrl = await compressImageToBase64(
          asset.uri,
          asset.width,
          asset.height,
        );
        setPendingImageUri(dataUrl);
      } finally {
        setIsCompressingImage(false);
      }
    }
  }, [closeAttachMenu]);

  const pickFromLibrary = useCallback(async () => {
    closeAttachMenu();
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 1,
    });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      setPendingImageDisplayUri(asset.uri);
      setIsCompressingImage(true);
      try {
        const dataUrl = await compressImageToBase64(
          asset.uri,
          asset.width,
          asset.height,
        );
        setPendingImageUri(dataUrl);
      } finally {
        setIsCompressingImage(false);
      }
    }
  }, [closeAttachMenu]);

  // Turn off thinking mode when an image is attached
  useEffect(() => {
    if (pendingImageUri && chatSettings.thinkingEnabled) {
      updateActiveSession((chat) => ({
        ...chat,
        settings: { ...chat.settings, thinkingEnabled: false },
      }));
    }
  }, [chatSettings.thinkingEnabled, pendingImageUri, updateActiveSession]);

  useEffect(() => {
    if (chatSettings.webSearchEnabled && chatSettings.thinkingEnabled) {
      updateActiveSession((chat) => ({
        ...chat,
        settings: { ...chat.settings, thinkingEnabled: false },
      }));
    }
  }, [
    chatSettings.thinkingEnabled,
    chatSettings.webSearchEnabled,
    updateActiveSession,
  ]);

  useEffect(() => {
    speakingMessageIdRef.current = speakingMessageId;
  }, [speakingMessageId]);

  useEffect(() => {
    return () => {
      cancelRecording().catch(() => {});
      stopSpeaking().catch(() => {});
    };
  }, [cancelRecording, stopSpeaking]);

  const stopVoicePlayback = useCallback(() => {
    stopSpeaking().catch(() => {});
    speakingMessageIdRef.current = null;
    setSpeakingMessageId(null);
  }, [stopSpeaking]);

  const stopVoiceCapture = useCallback(() => {
    if (!isRecordingVoice) return;
    cancelRecording().catch(() => {});
    setIsRecordingVoice(false);
    setIsRecordingPaused(false);
  }, [cancelRecording, isRecordingVoice]);

  const markModeModelPending = useCallback(
    (mode: ChatMode) => {
      if (mode === "translation") {
        if (loadedTranslationModelPath || isTranslationLoading) {
          return;
        }
      } else if (loadedModelPath || isChatModelLoading) {
        return;
      }

      setPendingModeModelLoad(mode);
    },
    [
      isChatModelLoading,
      isTranslationLoading,
      loadedModelPath,
      loadedTranslationModelPath,
    ],
  );

  const activateMode = useCallback(
    (mode: ChatMode, preferredChatId?: string) => {
      if (isGenerating) {
        return;
      }

      const currentChats = chatsRef.current;
      const currentSelectedChatIds = selectedChatIdsByModeRef.current;

      const preferredChat = preferredChatId
        ? currentChats.find(
            (chat) => chat.id === preferredChatId && chat.mode === mode,
          ) ?? null
        : null;

      if (
        activeChatModeRef.current === mode
        && (!preferredChatId || preferredChatId === activeChatRef.current.id)
      ) {
        setSidebarOpen(false);
        return;
      }

      stopVoicePlayback();
      stopVoiceCapture();
      discardIncognitoSession();
      markModeModelPending(mode);

      setActiveMode(mode);
      setSelectedChatIdForMode(mode, preferredChat?.id ?? currentSelectedChatIds[mode]);

      setSidebarOpen(false);
    },
    [
      discardIncognitoSession,
      isGenerating,
      markModeModelPending,
      setSelectedChatIdForMode,
      stopVoiceCapture,
      stopVoicePlayback,
    ],
  );

  const disableVoiceMode = useCallback(() => {
    setVoiceModeEnabled(false);
    clearVoiceError();
    stopVoiceCapture();
  }, [clearVoiceError, stopVoiceCapture]);

  useEffect(() => {
    if (!isTranslationMode) {
      return;
    }

    if (attachMenuOpen) {
      closeAttachMenu();
    }

    if (pendingImageUri !== null) {
      setPendingImageUri(null);
    }

    if (pendingImageDisplayUri !== null) {
      setPendingImageDisplayUri(null);
    }
  }, [
    attachMenuOpen,
    closeAttachMenu,
    isTranslationMode,
    pendingImageDisplayUri,
    pendingImageUri,
  ]);

  const updateActiveTranslationSettings = useCallback(
    (updates: Partial<TranslationChatSettings>) => {
      updateActiveSession((chat) => ({
        ...chat,
        translationSettings: {
          ...chat.translationSettings,
          ...updates,
        },
        lastTranslationPair:
          getExplicitTranslationLanguagePair({
            ...chat.translationSettings,
            ...updates,
          }) ?? chat.lastTranslationPair,
      }));
    },
    [updateActiveSession],
  );

  const openTranslationMode = useCallback(() => {
    activateMode("translation");
  }, [activateMode]);

  const openChatMode = useCallback(() => {
    activateMode("chat");
  }, [activateMode]);

  const selectTranslationLanguage = useCallback(
    (language: TranslationLanguageCode | TranslationTargetLanguageCode) => {
      if (translationLanguagePicker === "source") {
        updateActiveTranslationSettings({
          sourceLanguage: language as TranslationLanguageCode,
        });
      } else if (
        translationLanguagePicker === "target"
        && language !== "auto"
      ) {
        updateActiveTranslationSettings({
          targetLanguage: language as TranslationTargetLanguageCode,
        });
      }

      setTranslationLanguagePicker(null);
    },
    [translationLanguagePicker, updateActiveTranslationSettings],
  );

  const swapTranslationLanguages = useCallback(() => {
    updateActiveTranslationSettings(
      getSwappedTranslationSettings(translationSettings, lastTranslationPair),
    );
  }, [lastTranslationPair, translationSettings, updateActiveTranslationSettings]);

  const handleVoicePress = useCallback(async () => {
    if (!voiceAvailable) return;
    const voiceStatus = await getVoiceModelStatus().catch(() => ({
      sttDownloaded: false,
    }));
    if (!voiceStatus.sttDownloaded) {
      setVoiceModelsDownloaded(false);
      openModelCatalog("voice");
      return;
    }
    setVoiceModelsDownloaded(true);
    if (isTranscribingVoice || isRecordingVoice) return;

    clearVoiceError();

    try {
      await startRecording();
      setVoiceModeEnabled(true);
      setIsRecordingVoice(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[Voice] Recording failed to start:", msg);
      setIsRecordingVoice(false);
      Alert.alert("Voice Error", msg);
    }
  }, [
    voiceAvailable,
    getVoiceModelStatus,
    isTranscribingVoice,
    isRecordingVoice,
    clearVoiceError,
    openModelCatalog,
    startRecording,
  ]);

  const handlePauseResumeRecording = useCallback(async () => {
    if (!isRecordingVoice || isTranscribingVoice) return;
    if (!isRecordingPaused) {
      // Pause: stop the recorder, transcribe what we have, append to input,
      // then stay in paused state so the user can resume for more.
      setIsRecordingPaused(true);
      try {
        const transcript = await pauseAndTranscribe("en");
        if (transcript) {
          setInputText((prev) => {
            const base = prev.trimEnd();
            return base.length > 0 ? `${base} ${transcript}` : transcript;
          });
        }
      } catch (err) {
        console.warn("[Voice] Pause transcription failed:", err);
      }
    } else {
      try {
        await startRecording();
        setIsRecordingPaused(false);
      } catch (err) {
        console.warn("[Voice] Resume failed:", err);
        setIsRecordingPaused(false);
      }
    }
  }, [
    isRecordingVoice,
    isTranscribingVoice,
    isRecordingPaused,
    pauseAndTranscribe,
    startRecording,
  ]);

  const handleTranscribeAndExit = useCallback(async () => {
    if (isTranscribingVoice || isPreparingVoice) return;
    clearVoiceError();
    setIsTranscribingVoice(true);
    try {
      const transcript = await stopRecordingAndTranscribe("en");
      if (transcript) {
        setInputText((prev) => {
          const base = prev.trimEnd();
          return base.length > 0 ? `${base} ${transcript}` : transcript;
        });
        inputRef.current?.focus();
      }
    } catch (err) {
      console.warn("[Voice] Transcription failed:", err);
    } finally {
      setIsTranscribingVoice(false);
      setIsRecordingVoice(false);
      setIsRecordingPaused(false);
      setVoiceModeEnabled(false);
      clearVoiceError();
    }
  }, [
    isTranscribingVoice,
    isPreparingVoice,
    clearVoiceError,
    stopRecordingAndTranscribe,
    inputRef,
  ]);

  const handleClearImage = useCallback(() => {
    setPendingImageUri(null);
    setPendingImageDisplayUri(null);
  }, []);

  const scheduleInputClear = useCallback(() => {
    if (inputClearFrameRef.current !== null) {
      cancelAnimationFrame(inputClearFrameRef.current);
    }
    inputClearFrameRef.current = requestAnimationFrame(() => {
      inputClearFrameRef.current = null;
      setInputText("");
    });
  }, []);

  const handleInputFocus = useCallback(() => {
    if (!isAtBottomRef.current) return;
    setTimeout(() => scheduleScrollToEnd(true), 25);
  }, [scheduleScrollToEnd]);

  const setMessageTTSAdvisory = useCallback(
    (chatId: string, messageId: string, advisory?: string) => {
      if (!advisory) {
        clearMessageTTSAdvisoryTimeout(chatId, messageId);
      }

      updateSessionById(chatId, (chat) => ({
        ...chat,
        messages: chat.messages.map((message) =>
          message.id === messageId
            ? {
                ...message,
                ttsAdvisory: advisory,
              }
            : message,
        ),
      }));
    },
    [clearMessageTTSAdvisoryTimeout, updateSessionById],
  );

  const showTransientTTSAdvisory = useCallback(
    (chatId: string, messageId: string, advisory: string) => {
      const timerKey = getTTSAdvisoryTimerKey(chatId, messageId);

      clearMessageTTSAdvisoryTimeout(chatId, messageId);
      setMessageTTSAdvisory(chatId, messageId, advisory);

      const dismissTimer = setTimeout(() => {
        ttsAdvisoryTimeoutsRef.current.delete(timerKey);
        setMessageTTSAdvisory(chatId, messageId, undefined);
      }, TTS_ADVISORY_DISMISS_MS);

      ttsAdvisoryTimeoutsRef.current.set(timerKey, dismissTimer);
    },
    [
      clearMessageTTSAdvisoryTimeout,
      getTTSAdvisoryTimerKey,
      setMessageTTSAdvisory,
    ],
  );

  const handleSpeakMessage = useCallback(
    async (messageId: string, rawText: string) => {
      if (!voiceAvailable) return;
      if (speakingMessageIdRef.current === messageId) {
        stopVoicePlayback();
        return;
      }

      const { advisory, speechText, supported } = analyzeTTSLanguageSupport(rawText);
      const chatId = activeChatIdRef.current;

      if (!speechText.trim() || isRecordingVoice || isTranscribingVoice) return;

      if (!supported) {
        stopVoicePlayback();
        if (advisory) {
          showTransientTTSAdvisory(chatId, messageId, advisory);
        }
        return;
      }

      setMessageTTSAdvisory(chatId, messageId, undefined);

      const voiceStatus = await getVoiceModelStatus().catch(() => ({
        ttsDownloaded: false,
      }));
      if (!voiceStatus.ttsDownloaded) {
        setVoiceModelsDownloaded(false);
        openModelCatalog("voice");
        return;
      }
      setVoiceModelsDownloaded(true);

      stopVoicePlayback();
      setSpeakingMessageId(messageId);
      speakingMessageIdRef.current = messageId;

      try {
        await speakText(speechText);
      } catch (err) {
        console.warn("[Voice] TTS playback failed:", err);
      } finally {
        if (speakingMessageIdRef.current === messageId) {
          speakingMessageIdRef.current = null;
          setSpeakingMessageId(null);
        }
      }
    },
    [
      analyzeTTSLanguageSupport,
      voiceAvailable,
      getVoiceModelStatus,
      isRecordingVoice,
      isTranscribingVoice,
      openModelCatalog,
      setMessageTTSAdvisory,
      showTransientTTSAdvisory,
      stopVoicePlayback,
      speakText,
    ],
  );

  const newChat = useCallback(() => {
    if (isGenerating) return;

    const currentActiveChat = activeChatRef.current;
    const nextMode = activeChatModeRef.current;
    const currentSelectedChatId = selectedChatIdsByModeRef.current[nextMode];
    const isCurrentSessionPersisted = currentSelectedChatId === currentActiveChat.id;

    if (isCurrentSessionPersisted && isUntitledEmptyChat(currentActiveChat)) {
      setSidebarOpen(false);
      return;
    }

    stopVoicePlayback();
    stopVoiceCapture();
    discardIncognitoSession();
    markModeModelPending(nextMode);
    const chat = makeNewChat(nextMode);
    setChats((prev) => [chat, ...prev]);
    setSelectedChatIdForMode(nextMode, chat.id);
    setActiveMode(nextMode);
    setSidebarOpen(false);
  }, [
    discardIncognitoSession,
    isGenerating,
    markModeModelPending,
    setSelectedChatIdForMode,
    stopVoicePlayback,
    stopVoiceCapture,
  ]);

  const startIncognitoChat = useCallback(() => {
    if (isGenerating) {
      return;
    }

    const nextMode = activeChatModeRef.current;
    const currentIncognitoChat = incognitoChatRef.current;

    if (currentIncognitoChat?.mode === nextMode) {
      setSidebarOpen(false);
      return;
    }

    stopVoicePlayback();
    stopVoiceCapture();
    markModeModelPending(nextMode);
    setIncognitoChat(makeNewChat(nextMode));
    setActiveMode(nextMode);
    setSidebarOpen(false);
  }, [
    isGenerating,
    markModeModelPending,
    stopVoicePlayback,
    stopVoiceCapture,
  ]);

  const selectChat = useCallback(
    (id: string) => {
      const chat = chatsRef.current.find((candidate) => candidate.id === id);
      if (!chat) {
        return;
      }

      activateMode(chat.mode, chat.id);
    },
    [activateMode],
  );

  const deleteChat = useCallback(
    (id: string) => {
      stopVoicePlayback();
      stopVoiceCapture();
      const currentChats = chatsRef.current;
      const deletedChat = currentChats.find((chat) => chat.id === id);

      if (!deletedChat) {
        return;
      }

      const remaining = currentChats.filter((chat) => chat.id !== id);
      const remainingSameMode = remaining.filter(
        (chat) => chat.mode === deletedChat.mode,
      );

      setChats(remaining);
      setSelectedChatIdsByMode((prev) =>
        prev[deletedChat.mode] !== id
          ? prev
          : {
              ...prev,
              [deletedChat.mode]: remainingSameMode[0]?.id ?? null,
            }
      );
    },
    [stopVoicePlayback, stopVoiceCapture],
  );

  const deleteAllChats = useCallback(() => {
    stopVoicePlayback();
    stopVoiceCapture();
    setChats([]);
    setSelectedChatIdsByMode({ chat: null, translation: null });
    void AsyncStorage.multiRemove([CHATS_STORAGE_KEY, ACTIVE_CHAT_ID_KEY]);
  }, [stopVoicePlayback, stopVoiceCapture]);

  const agentRef = useRef<Agent | null>(null);

  const runAgentGeneration = useCallback(
    async ({
      chatId,
      assistantId,
      historyMessages,
      userText,
      imageUri,
      settings,
      thinkingBudget: agentThinkingBudget,
    }: {
      chatId: string;
      assistantId: string;
      historyMessages: Message[];
      userText: string;
      imageUri?: string | null;
      settings: ChatSettings;
      thinkingBudget?: ThinkingBudget;
    }) => {
      const updateAssistantMessage = (
        content: string,
        isStreaming: boolean,
        updates?: Partial<Message>,
      ) => {
        updateSessionById(chatId, (chat) => ({
          ...chat,
          messages: chat.messages.map((message) =>
            message.id === assistantId
              ? { ...message, ...(updates ?? {}), content, isStreaming }
              : message,
          ),
        }));
      };

      const model = loadedModelPath
        ? (ALL_MODELS.find((m) => loadedModelPath.endsWith(m.filename)) ?? null)
        : null;

      const systemPrompt =
        settings.systemPrompt?.trim() || DEFAULT_SYSTEM_PROMPT;

      // Create a fresh agent for each generation to avoid stale state.
      // Use the ref to avoid recreating this callback when isGenerating flips.
      const agent = new Agent(llamaContextRef.current, {
        systemPrompt,
        tools: [webSearchTool],
        maxIterations: 3,
        thinking: settings.thinkingEnabled,
        thinkingBudget: agentThinkingBudget?.maxReasoningTokens,
        alwaysThinks: model?.alwaysThinks ?? false,
        nativeReasoning: model?.nativeReasoning ?? false,
        onEvent: (event: AgentEvent) => {
          switch (event.type) {
            case "text":
              updateAssistantMessage(event.content, true, {
                searchQuery: undefined,
              });
              break;
            case "thinking":
              updateAssistantMessage(
                mergeReasoningIntoContent(event.content, ""),
                true,
                { reasoningComplete: false },
              );
              break;
            case "toolCall":
              updateAssistantMessage(
                `Searching DuckDuckGo for "${typeof event.args.query === "string" ? event.args.query : "..."}"...`,
                true,
                {
                  searchQuery: typeof event.args.query === "string"
                    ? event.args.query
                    : undefined,
                },
              );
              break;
            case "toolResult": {
              const meta = event.result.metadata as
                | { webSearchResults?: WebSearchResult[] }
                | undefined;
              updateAssistantMessage(
                "Analyzing search results...",
                true,
                {
                  webSearchResults: meta?.webSearchResults,
                },
              );
              break;
            }
            case "iterationStart":
              if (event.iteration > 0) {
                updateAssistantMessage(
                  "Refining search...",
                  true,
                );
              }
              break;
            case "done":
              updateAssistantMessage(event.finalText, false, {
                searchQuery: undefined,
              });
              break;
            case "error":
              if (!event.recoverable) {
                updateAssistantMessage(
                  `Error: ${event.error}`,
                  false,
                );
              }
              break;
          }
          scheduleScrollToEnd(true);
        },
      });

      agentRef.current = agent;

      // Build conversation history from prior messages for context.
      const contextWindow = settings.contextWindow ?? 6;
      const recentMessages = historyMessages.slice(-(contextWindow * 2));
      for (const msg of recentMessages) {
        if (msg.role === "user") {
          agent.appendUserMessage(msg.content);
        } else if (msg.role === "assistant" && msg.content) {
          // Manually push to history for context (not via appendUserMessage).
          const stripped = parseThinking(msg.content);
          agent.getHistory().push({
            role: "assistant",
            content: stripped.response,
            ...(stripped.thinking
              ? { reasoning_content: stripped.thinking }
              : {}),
          });
        }
      }
      // Remove the user messages we just added — the agent.run() call
      // will add the current user message.
      agent.clearHistory();

      try {
        const images = imageUri ? [imageUri] : undefined;
        await agent.run(userText, images);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        updateAssistantMessage(`Error: ${message}`, false);
      } finally {
        agentRef.current = null;
      }
    },
    [loadedModelPath, updateSessionById, scheduleScrollToEnd],
  );

  const runAssistantGeneration = useCallback(
    async ({
      chatId,
      assistantId: initialAssistantId,
      historyMessages,
      sourceIds,
      userText,
      imageUri,
      settings,
      thinkingBudget,
    }: {
      chatId: string;
      assistantId: string;
      historyMessages: Message[];
      sourceIds: string[];
      userText: string;
      imageUri?: string | null;
      settings: ChatSettings;
      thinkingBudget?: ThinkingBudget;
    }) => {
      const updateAssistantMessage = (
        targetAssistantId: string,
        content: string,
        isStreaming: boolean,
        updates?: Partial<Message>,
      ) => {
        updateSessionById(chatId, (chat) => ({
          ...chat,
          messages: chat.messages.map((message) =>
            message.id === targetAssistantId
              ? {
                  ...message,
                  ...(updates ?? {}),
                  content: message.reasoningComplete
                    ? mergeReasoningIntoContent(message.content, content)
                    : content,
                  isStreaming,
                }
              : message,
          ),
        }));
      };

      const logFinalAssistantResponse = (finalContent: string) => {
        console.log("[TensorChat] final response:", finalContent);
      };

      const replaceAssistantAttempt = (
        currentAssistantId: string,
        nextAssistantId: string,
        preservedContent: string,
      ) => {
        const preservedReasoning = parseThinking(preservedContent).thinking;

        updateSessionById(chatId, (chat) => ({
          ...chat,
          messages: chat.messages.map((message) =>
            message.id === currentAssistantId
              ? {
                  ...message,
                  id: nextAssistantId,
                  content: mergeReasoningIntoContent(preservedContent, ""),
                  isStreaming: true,
                  reasoningComplete: preservedReasoning !== null,
                  searchQuery: undefined,
                  webSearchResults: undefined,
                  toolTranscript: undefined,
                  webSearchAdvisory: undefined,
                }
              : message,
          ),
        }));
      };

      // Agent mode delegation — when enabled, use the Agent SDK for the
      // entire generation loop instead of the inline tool-calling logic below.
      if (settings.agentModeEnabled) {
        await runAgentGeneration({
          chatId,
          assistantId: initialAssistantId,
          historyMessages,
          userText,
          imageUri,
          settings,
          thinkingBudget,
        });
        return;
      }

      const isVisionRequest = typeof imageUri === "string";
      const usesWebSearchFlow = settings.webSearchEnabled && !isVisionRequest;
      const canUseThinkingThisTurn = settings.thinkingEnabled
        && !isVisionRequest
        && !usesWebSearchFlow;
      let assistantId = initialAssistantId;
      let thinkingEnabled = canUseThinkingThisTurn;
      let allowAutoFallback = thinkingEnabled;
      let retrievedContext: string | undefined;
      let retrievedContextSections: string[] = [];
      let currentToolTranscript: AssistantToolTranscript | undefined;
      let pendingWebSearchResults: WebSearchResult[] | undefined;
      let pendingSearchQuery: string | undefined;
      let pendingWebSearchAdvisory: string | undefined;
      // For alwaysThinks models (e.g. LFM 1.2B Thinking), skip the
      // tool-calling round entirely — the model struggles to combine
      // thinking tokens with tool call generation. Instead, search
      // immediately using the user's query and include results in context.
      const useDirectSearch = usesWebSearchFlow && modelAlwaysThinks;
      let remainingToolRounds = usesWebSearchFlow && !useDirectSearch
        ? MAX_WEB_SEARCH_TOOL_ROUNDS
        : 0;
      let directSearchContext: string | undefined;
      const promptDateTime = formatPromptDateTime(new Date());

      manualStopRequestedRef.current = false;

      try {
        // Direct search for alwaysThinks models — run the search upfront
        // and pass results as context instead of asking the model to call tools.
        if (useDirectSearch && userText.trim().length > 0) {
          updateAssistantMessage(
            assistantId,
            buildWebSearchStatusText(userText.trim()),
            true,
          );
          if (isAtBottomRef.current) {
            scheduleScrollToEnd(false);
          }
          try {
            const searchResult = await runDuckDuckGoSearch(userText.trim());
            if (searchResult.results.length > 0) {
              pendingSearchQuery = searchResult.query;
              pendingWebSearchResults = searchResult.results;
              // Format results as plain text for better comprehension by small models.
              directSearchContext = searchResult.results
                .map((r, i) => `[${i + 1}] ${r.title}\n${r.snippet}`)
                .join("\n\n");
            }
          } catch (searchErr) {
            console.warn("[TensorChat] direct web search failed:", searchErr);
          }
        }

        if (sourceIds.length > 0 && userText.trim().length > 0) {
          try {
            const results = await querySources(sourceIds, userText, {
              nResults: RAG_QUERY_RESULT_COUNT,
            });
            retrievedContextSections = buildRetrievedContextSections(results);
            retrievedContext =
              joinRetrievedContextSections(retrievedContextSections) ?? undefined;
          } catch (retrievalError) {
            console.warn("[TensorChat] retrieval query failed:", retrievalError);
          }
        }

        while (true) {
          const attemptSettings: ChatSettings = {
            ...settings,
            thinkingEnabled,
          };
          const attemptToolOptions =
            remainingToolRounds > 0
            && attemptSettings.webSearchEnabled
            && !isVisionRequest
            && !currentToolTranscript
              ? {
                  thinking: attemptSettings.thinkingEnabled,
                  tools: [WEB_SEARCH_TOOL],
                  toolChoice: "auto",
                }
              : {
                  thinking: attemptSettings.thinkingEnabled,
                };
          if (retrievedContextSections.length > 0 && loadedContextSize !== null) {
            const baseRequest = buildAssistantRequest({
              messages: historyMessages,
              newUserText: userText,
              settings: attemptSettings,
              thinkingBudget,
              imageUri,
              currentToolTranscript,
              promptDateTime,
              modelSupportsThinking,
              modelAlwaysThinks,
              modelNativeReasoning,
              tools: attemptSettings.webSearchEnabled ? [WEB_SEARCH_TOOL] : undefined,
              directSearchContext,
            });
            const maxPromptTokens = Math.max(
              RAG_CONTEXT_MIN_PROMPT_TOKENS,
              loadedContextSize
                - getGenerationTokenBudget(
                  baseRequest.isVisionRequest
                    || Array.isArray(baseRequest.promptOrMessages),
                  attemptSettings.thinkingEnabled,
                  thinkingBudget,
                )
                - RAG_CONTEXT_TOKEN_MARGIN,
            );
            const fittedContext = await fitRetrievedContextToBudget({
              candidateSections: retrievedContextSections,
              maxPromptTokens,
              maxRetrievedContextTokens: RAG_CONTEXT_MAX_RETRIEVED_TOKENS,
              countPromptTokens: (nextRetrievedContext) => {
                const attemptRequest = buildAssistantRequest({
                  messages: historyMessages,
                  newUserText: userText,
                  settings: attemptSettings,
                  thinkingBudget,
                  imageUri,
                  retrievedContext: nextRetrievedContext,
                  currentToolTranscript,
                  promptDateTime,
                  modelSupportsThinking,
                  modelAlwaysThinks,
                  modelNativeReasoning,
                  tools: attemptSettings.webSearchEnabled ? [WEB_SEARCH_TOOL] : undefined,
                  directSearchContext,
                });

                return countPromptTokens(
                  attemptRequest.promptOrMessages,
                  attemptToolOptions,
                );
              },
            });
            retrievedContext = fittedContext.retrievedContext;

            if (fittedContext.usedFallback) {
              console.warn(
                "[TensorChat] prompt token counting unavailable; falling back to static RAG context cap.",
              );
            } else {
              console.log("[TensorChat] fitted retrieved context:", {
                basePromptTokens: fittedContext.basePromptTokenCount,
                promptTokens: fittedContext.promptTokenCount,
                maxPromptTokens,
                maxRetrievedContextTokens: RAG_CONTEXT_MAX_RETRIEVED_TOKENS,
                retrievedContextTokens: fittedContext.retrievedContextTokenCount,
                sectionsAvailable: retrievedContextSections.length,
                sectionsUsed: fittedContext.sectionsUsed,
                contextChars: retrievedContext?.length ?? 0,
                trimmed: fittedContext.wasTrimmed,
              });
            }
          }

          const { promptOrMessages } = buildAssistantRequest({
            messages: historyMessages,
            newUserText: userText,
            settings: attemptSettings,
            thinkingBudget,
            imageUri,
            retrievedContext,
            currentToolTranscript,
            promptDateTime,
            modelSupportsThinking,
            modelAlwaysThinks,
            modelNativeReasoning,
            tools: attemptSettings.webSearchEnabled ? [WEB_SEARCH_TOOL] : undefined,
            directSearchContext,
          });
          const allowToolCallingThisAttempt =
            remainingToolRounds > 0
            && attemptSettings.webSearchEnabled
            && !isVisionRequest
            && !currentToolTranscript;
          const isFallbackAttempt = !thinkingEnabled && canUseThinkingThisTurn;

          console.log(
            "[TensorChat] " +
              (isVisionRequest
                ? "vision message (base64 omitted)"
                : allowToolCallingThisAttempt
                  ? "tool-enabled messages:"
                : isFallbackAttempt
                  ? "fallback prompt:"
                  : typeof promptOrMessages === "string"
                    ? "prompt:"
                    : "structured messages:"),
            isVisionRequest ? "[structured messages with image]" : promptOrMessages,
          );

          let pendingCombinedContent = "";
          let shouldFallback = false;
          // Don't cap reasoning for alwaysThinks models — they handle thinking
          // natively and there's no fallback retry mechanism. Capping just
          // produces an empty response since the model can't be told to stop thinking.
          const reasoningTokenLimit = thinkingEnabled
            ? (thinkingBudget?.maxReasoningTokens ?? 0)
            : 0;

          const finalOutput = await generateResponse(
            promptOrMessages,
            (stream) => {
              if (shouldFallback) {
                return;
              }

              pendingCombinedContent = stream.combinedContent;
              if (streamFlushRef.current === null) {
                streamFlushRef.current = requestAnimationFrame(() => {
                  streamFlushRef.current = null;
                  updateAssistantMessage(assistantId, pendingCombinedContent, true);
                  if (isAtBottomRef.current) {
                    scheduleScrollToEnd(false);
                  }
                });
              }

              if (
                reasoningTokenLimit > 0
                && stream.reasoningTokenCount >= reasoningTokenLimit
                && !hasAssistantResponse(stream.responseContent)
                && !manualStopRequestedRef.current
              ) {
                shouldFallback = true;
                if (streamFlushRef.current !== null) {
                  cancelAnimationFrame(streamFlushRef.current);
                  streamFlushRef.current = null;
                }
                void stopLlamaGeneration().catch((stopErr) => {
                  console.warn(
                    "[TensorChat] failed to stop capped reasoning attempt:",
                    stopErr,
                  );
                });
              }
            },
            {
              thinking: thinkingEnabled,
              alwaysThinks: modelAlwaysThinks,
              nativeReasoning: modelNativeReasoning,
              thinkingBudget,
              ...(allowToolCallingThisAttempt
                ? {
                    tools: [WEB_SEARCH_TOOL],
                    toolChoice: "auto",
                  }
                : {}),
            },
          );

          if (streamFlushRef.current !== null) {
            cancelAnimationFrame(streamFlushRef.current);
            streamFlushRef.current = null;
          }

          if (manualStopRequestedRef.current) {
            const finalContent = finalOutput.combinedContent || pendingCombinedContent;
            updateAssistantMessage(
              assistantId,
              finalContent,
              false,
              {
                searchQuery: pendingSearchQuery,
                webSearchResults: pendingWebSearchResults,
                toolTranscript: currentToolTranscript,
                webSearchAdvisory: pendingWebSearchAdvisory,
              },
            );
            if (isAtBottomRef.current) {
              scheduleScrollToEnd(false);
            }
            logFinalAssistantResponse(finalContent);
            break;
          }

          const toolCalls = allowToolCallingThisAttempt
            ? normalizeAssistantToolCalls(finalOutput.toolCalls)
            : [];

          if (toolCalls.length > 0 && remainingToolRounds > 0) {
            const executedToolCalls = await executeWebSearchToolCalls(toolCalls, userText);

            currentToolTranscript = {
              content: finalOutput.responseContent,
              toolCalls: executedToolCalls.toolCalls,
              toolResults: executedToolCalls.toolResults,
            };
            pendingWebSearchResults = executedToolCalls.webSearchResults;
            pendingSearchQuery = executedToolCalls.searchQuery;
            pendingWebSearchAdvisory = undefined;
            remainingToolRounds -= 1;

            updateAssistantMessage(
              assistantId,
              buildWebSearchStatusText(pendingSearchQuery),
              true,
              {
                searchQuery: undefined,
                webSearchResults: undefined,
                toolTranscript: undefined,
                webSearchAdvisory: undefined,
              },
            );
            if (isAtBottomRef.current) {
              scheduleScrollToEnd(false);
            }

            if (manualStopRequestedRef.current) {
              updateAssistantMessage(
                assistantId,
                buildWebSearchStatusText(pendingSearchQuery),
                false,
                {
                  searchQuery: undefined,
                  webSearchResults: undefined,
                  toolTranscript: undefined,
                  webSearchAdvisory: undefined,
                },
              );
              break;
            }

            continue;
          }

          const shouldRetryWithoutThinking =
            allowAutoFallback
            && !hasAssistantResponse(finalOutput.responseContent)
            && (shouldFallback || finalOutput.reasoningContent.length > 0);

          if (shouldRetryWithoutThinking) {
            const nextAssistantId = nextId();
            replaceAssistantAttempt(
              assistantId,
              nextAssistantId,
              finalOutput.combinedContent || pendingCombinedContent,
            );
            if (isAtBottomRef.current) {
              scheduleScrollToEnd(false);
            }
            assistantId = nextAssistantId;
            thinkingEnabled = false;
            allowAutoFallback = false;
            continue;
          }

          const finalContent = finalOutput.combinedContent || pendingCombinedContent;
          pendingWebSearchAdvisory = usesWebSearchFlow
            && loadedModel?.baseModel === "0.8B"
            && !currentToolTranscript
            && toolCalls.length === 0
            && hasAssistantResponse(finalOutput.responseContent)
              ? WEB_SEARCH_MODEL_ADVISORY
              : undefined;
          // For direct search, create a synthetic tool transcript for the badge
          // display AFTER generation (not before, to avoid bloating the prompt).
          if (useDirectSearch && pendingSearchQuery && !currentToolTranscript) {
            currentToolTranscript = {
              content: "",
              toolCalls: [{
                type: "function",
                id: "direct_search",
                function: {
                  name: "web_search",
                  arguments: JSON.stringify({ query: pendingSearchQuery }),
                },
              }],
              toolResults: [],
            };
          }
          updateAssistantMessage(
            assistantId,
            finalContent,
            false,
            {
              searchQuery: pendingSearchQuery,
              webSearchResults: pendingWebSearchResults,
              toolTranscript: currentToolTranscript,
              webSearchAdvisory: pendingWebSearchAdvisory,
            },
          );
          if (isAtBottomRef.current) {
            scheduleScrollToEnd(false);
          }
          logFinalAssistantResponse(finalContent);
          break;
        }
      } catch (err) {
        if (streamFlushRef.current !== null) {
          cancelAnimationFrame(streamFlushRef.current);
          streamFlushRef.current = null;
        }

        console.error("[TensorChat] assistant generation error:", err);
        updateAssistantMessage(
          assistantId,
          `Error: ${err instanceof Error ? err.message : String(err)}`,
          false,
          {
            searchQuery: pendingSearchQuery,
            webSearchResults: pendingWebSearchResults,
            toolTranscript: currentToolTranscript,
            webSearchAdvisory: pendingWebSearchAdvisory,
          },
        );
      } finally {
        manualStopRequestedRef.current = false;
      }
    },
    [
      generateResponse,
      loadedModel?.baseModel,
      querySources,
      runAgentGeneration,
      scheduleScrollToEnd,
      stopLlamaGeneration,
      updateSessionById,
    ],
  );

  const runTranslationGeneration = useCallback(
    async ({
      chatId,
      assistantId,
      userText,
      translationSettings,
    }: {
      chatId: string;
      assistantId: string;
      userText: string;
      translationSettings: TranslationChatSettings;
    }) => {
      const updateAssistantMessage = (
        content: string,
        isStreaming: boolean,
      ) => {
        updateSessionById(chatId, (chat) => ({
          ...chat,
          messages: chat.messages.map((message) =>
            message.id === assistantId
              ? {
                  ...message,
                  content,
                  isStreaming,
                }
              : message,
          ),
        }));
      };

      manualStopRequestedRef.current = false;

      try {
        // Keep translation requests stateless so source/target changes apply immediately.
        const prompt = buildTranslationPrompt({
          newUserText: userText,
          translationSettings,
          translationModel: loadedTranslationModel,
        });
        let pendingContent = "";

        const finalOutput = await generateTranslation(
          prompt,
          (stream) => {
            pendingContent = stream.content;
            if (streamFlushRef.current === null) {
              streamFlushRef.current = requestAnimationFrame(() => {
                streamFlushRef.current = null;
                updateAssistantMessage(pendingContent, true);
                if (isAtBottomRef.current) {
                  scheduleScrollToEnd(false);
                }
              });
            }
          },
          {
            maxGenerationTokens: 1024,
            stop: getTranslationStopTokens(loadedTranslationModel),
          },
        );

        if (streamFlushRef.current !== null) {
          cancelAnimationFrame(streamFlushRef.current);
          streamFlushRef.current = null;
        }

        const finalContent = finalOutput.content || pendingContent;
        updateAssistantMessage(finalContent, false);
        if (isAtBottomRef.current) {
          scheduleScrollToEnd(false);
        }
      } catch (err) {
        if (streamFlushRef.current !== null) {
          cancelAnimationFrame(streamFlushRef.current);
          streamFlushRef.current = null;
        }

        updateAssistantMessage(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
          false,
        );
      } finally {
        manualStopRequestedRef.current = false;
      }
    },
    [
      generateTranslation,
      loadedTranslationModel,
      scheduleScrollToEnd,
      updateSessionById,
    ],
  );

  const sendMessage = useCallback(async () => {
    const text = inputText.trim();
    const currentActiveMode = activeChatModeRef.current;
    const currentActiveChat = activeChatRef.current;
    const currentIsTranslationMode = isTranslationModeRef.current;
    const currentMessages = messagesRef.current;
    const currentChatSettings = chatSettingsRef.current;
    const currentTranslationSettings = translationSettingsRef.current;
    const currentLastTranslationPair = lastTranslationPairRef.current;
    const currentDraftSourceIds = draftSourceIdsRef.current;
    const currentSources = sourcesRef.current;
    const imageUri = currentIsTranslationMode ? null : pendingImageUri;
    if (
      (!text && !imageUri) ||
      isGenerating ||
      !activeLoadedModelPathRef.current ||
      isCompressingImage
    )
      return;

    inputRef.current?.blur();
    Keyboard.dismiss();

    stopVoiceCapture();
    stopVoicePlayback();

    scheduleInputClear();
    setPendingImageUri(null);
    setPendingImageDisplayUri(null);

    const messageAttachments = currentIsTranslationMode
      ? []
      : buildMessageAttachmentSnapshot(
          currentDraftSourceIds,
          currentSources,
        );
    const queryableSourceIds = !currentIsTranslationMode && isEmbeddingModelEnabled
      ? messageAttachments.map((attachment) => attachment.sourceId)
      : [];
    const resolvedTranslationSourceLanguage = currentIsTranslationMode
      ? resolveTranslationSourceLanguageCode(
          text,
          currentTranslationSettings,
          currentLastTranslationPair,
        )
      : null;
    const translationMessageBadges = currentIsTranslationMode
      ? buildTranslationMessageBadges(
          currentTranslationSettings,
          resolveTranslationSourceBadgeLabel(
            text,
            currentTranslationSettings,
            currentLastTranslationPair,
          ),
        )
      : null;

    const userMsg: Message = {
      id: nextId(),
      role: "user",
      content: text,
      imageUri: imageUri ?? undefined,
      imageDisplayUri: pendingImageDisplayUri ?? undefined,
      attachedSources: messageAttachments,
      translationBadge: translationMessageBadges?.userBadge,
    };
    const assistantId = nextId();
    const assistantMsg: Message = {
      id: assistantId,
      role: "assistant",
      content: "",
      isStreaming: true,
      translationBadge: translationMessageBadges?.assistantBadge,
    };

    const appendMessages = (chat: Chat): Chat => ({
      ...chat,
      lastTranslationPair:
        currentIsTranslationMode && resolvedTranslationSourceLanguage
          ? {
              sourceLanguage: resolvedTranslationSourceLanguage,
              targetLanguage: currentTranslationSettings.targetLanguage,
            }
          : chat.lastTranslationPair,
      title:
        chat.messages.length === 0 && !chat.titleEdited
          ? (text || "Image").slice(0, 40)
          : chat.title,
      messages: [...chat.messages, userMsg, assistantMsg],
    });

    const currentSelectedChatId =
      selectedChatIdsByModeRef.current[currentActiveMode];
    const chatId = currentActiveChat.id;
    if (incognitoChatRef.current?.id === chatId || currentSelectedChatId === chatId) {
      updateSessionById(chatId, appendMessages);
    } else {
      materializeModeDraftChat(currentActiveMode, appendMessages);
    }

    scheduleScrollToEnd(false);

    if (currentIsTranslationMode) {
      await runTranslationGeneration({
        chatId,
        assistantId,
        userText: text,
        translationSettings: { ...currentTranslationSettings },
      });
      return;
    }

    await runAssistantGeneration({
      chatId,
      assistantId,
      historyMessages: currentMessages,
      sourceIds: queryableSourceIds,
      userText: text,
      imageUri,
      settings: { ...currentChatSettings },
      thinkingBudget,
    });
  }, [
    inputText,
    pendingImageUri,
    pendingImageDisplayUri,
    isGenerating,
    isCompressingImage,
    isEmbeddingModelEnabled,
    thinkingBudget,
    scheduleScrollToEnd,
    scheduleInputClear,
    materializeModeDraftChat,
    stopVoiceCapture,
    stopVoicePlayback,
    runAssistantGeneration,
    runTranslationGeneration,
    updateSessionById,
  ]);

  const lastRetryableAssistantId = useMemo(() => {
    const lastMessage = messages[messages.length - 1];
    const previousMessage = messages[messages.length - 2];

    if (lastMessage?.role !== "assistant" || lastMessage.isStreaming) {
      return null;
    }

    return previousMessage?.role === "user" ? lastMessage.id : null;
  }, [messages]);

  const attachedSources = useMemo<RagSource[]>(() => {
    const attachedIds = new Set(draftSourceIds);
    return sources.filter((source) => attachedIds.has(source.id));
  }, [draftSourceIds, sources]);

  const retryLastMessage = useCallback(async () => {
    if (isGenerating || !activeLoadedModelPathRef.current) {
      return;
    }

    const currentMessages = messagesRef.current;
    const currentIsTranslationMode = isTranslationModeRef.current;
    const currentTranslationSettings = translationSettingsRef.current;
    const currentLastTranslationPair = lastTranslationPairRef.current;
    const currentEffectiveSourceIds = effectiveSourceIdsRef.current;
    const currentChatSettings = chatSettingsRef.current;

    const lastAssistantMessage = currentMessages[currentMessages.length - 1];
    const lastUserMessage = currentMessages[currentMessages.length - 2];

    if (
      lastAssistantMessage?.role !== "assistant" ||
      lastAssistantMessage.isStreaming ||
      lastUserMessage?.role !== "user"
    ) {
      return;
    }

    stopVoiceCapture();
    stopVoicePlayback();

    const chatId = activeChatIdRef.current;
    const assistantId = nextId();
    const historyMessages = currentMessages.slice(0, -2);
    const retryImageUri = currentIsTranslationMode ? undefined : lastUserMessage.imageUri;
    const retrySourceIds = getMessageAttachmentSourceIds(
      lastUserMessage,
      currentEffectiveSourceIds,
    );
    const retryResolvedSourceLanguage = currentIsTranslationMode
      ? resolveTranslationSourceLanguageCode(
          lastUserMessage.content,
          currentTranslationSettings,
          currentLastTranslationPair,
        )
      : null;
    const retryTranslationBadges = currentIsTranslationMode
      ? buildTranslationMessageBadges(
          currentTranslationSettings,
          resolveTranslationSourceBadgeLabel(
            lastUserMessage.content,
            currentTranslationSettings,
            currentLastTranslationPair,
          ),
        )
      : null;

    updateSessionById(chatId, (chat) => ({
      ...chat,
      lastTranslationPair:
        currentIsTranslationMode && retryResolvedSourceLanguage
          ? {
              sourceLanguage: retryResolvedSourceLanguage,
              targetLanguage: currentTranslationSettings.targetLanguage,
            }
          : chat.lastTranslationPair,
      messages: chat.messages.map((message) =>
        message.id === lastUserMessage.id && retryTranslationBadges
          ? {
              ...message,
              translationBadge: retryTranslationBadges.userBadge,
            }
          : message.id === lastAssistantMessage.id
          ? {
              ...message,
              id: assistantId,
              content: "",
              isStreaming: true,
              reasoningComplete: false,
              searchQuery: undefined,
              webSearchResults: undefined,
              toolTranscript: undefined,
              webSearchAdvisory: undefined,
              translationBadge:
                retryTranslationBadges?.assistantBadge ?? message.translationBadge,
            }
          : message,
      ),
    }));
    scheduleScrollToEnd(false);

    if (currentIsTranslationMode) {
      await runTranslationGeneration({
        chatId,
        assistantId,
        userText: lastUserMessage.content,
        translationSettings: { ...currentTranslationSettings },
      });
      return;
    }

    await runAssistantGeneration({
      chatId,
      assistantId,
      historyMessages,
      sourceIds: retrySourceIds,
      userText: lastUserMessage.content,
      imageUri: retryImageUri,
      settings: { ...currentChatSettings },
      thinkingBudget,
    });
  }, [
    isGenerating,
    runAssistantGeneration,
    runTranslationGeneration,
    scheduleScrollToEnd,
    stopVoiceCapture,
    stopVoicePlayback,
    thinkingBudget,
    updateSessionById,
  ]);

  const renderItem = useCallback(
    ({ item }: { item: Message }) => (
      <MessageBubble
        message={item}
        onSpeak={
          item.role === "assistant" && !isTranslationMode
            ? handleSpeakMessage
            : undefined
        }
        onRetry={
          item.id === lastRetryableAssistantId ? retryLastMessage : undefined
        }
        showRetry={item.id === lastRetryableAssistantId}
        retryDisabled={isGenerating || !activeLoadedModelPath}
        isSpeaking={speakingMessageId === item.id}
        isTTSSyncing={isTTSSyncing && speakingMessageId === item.id}
        ttsDisabled={
          !voiceAvailable ||
          isRecordingVoice ||
          isTranscribingVoice ||
          isPreparingVoice
        }
      />
    ),
    [
      handleSpeakMessage,
      isTranslationMode,
      activeLoadedModelPath,
      isGenerating,
      speakingMessageId,
      isTTSSyncing,
      voiceAvailable,
      isRecordingVoice,
      isTranscribingVoice,
      isPreparingVoice,
      lastRetryableAssistantId,
      retryLastMessage,
    ],
  );

  const keyExtractor = useCallback((item: Message) => item.id, []);

  const chatSummaries: ChatSummary[] = chats
    .filter((chat) => chat.mode === activeChatMode)
    .map((chat) => ({
      id: chat.id,
      title: chat.title,
      createdAt: chat.createdAt,
      mode: chat.mode,
    }));
  const drawerOverlayOpacity = drawerTranslateX.interpolate({
    inputRange: [0, Math.max(sidebarWidth, 1)],
    outputRange: [0, 1],
    extrapolate: "clamp",
  });
  const openDefaultModelCatalog = useCallback(() => {
    openModelCatalog("0.8B");
  }, [openModelCatalog]);
  const openManageModels = useCallback(() => {
    openModelCatalog("downloaded");
  }, [openModelCatalog]);
  const openCurrentModeModelCatalog = useCallback(() => {
    openModelCatalog(isTranslationMode ? "translation" : "0.8B");
  }, [isTranslationMode, openModelCatalog]);
  const handleShowModelPicker = useCallback(() => {
    setModelPickerVisible(true);
  }, []);
  const handleHideModelPicker = useCallback(() => {
    setModelPickerVisible(false);
  }, []);
  const handlePressTranslationSource = useCallback(() => {
    setTranslationLanguagePicker("source");
  }, []);
  const handlePressTranslationTarget = useCallback(() => {
    setTranslationLanguagePicker("target");
  }, []);
  const handleRemoveAttachedSource = useCallback(
    (sourceId: string) => {
      detachSourceFromChat(activeChatIdRef.current, sourceId);
    },
    [detachSourceFromChat],
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={["left", "right"]}>
      <Modal
        visible={renameChatId !== null}
        animationType="fade"
        transparent
        presentationStyle="overFullScreen"
        onRequestClose={closeRenameModal}
      >
        <View style={styles.renameModalScreen}>
          <Pressable style={StyleSheet.absoluteFillObject} onPress={closeRenameModal} />
          <View style={styles.renameCard}>
            <Text style={styles.renameTitle}>Rename thread</Text>
            <TextInput
              value={renameDraftTitle}
              onChangeText={setRenameDraftTitle}
              placeholder="Thread name"
              placeholderTextColor={colors.textTertiary}
              style={styles.renameInput}
              autoFocus
              selectTextOnFocus
              maxLength={80}
              returnKeyType="done"
              onSubmitEditing={submitRenameChat}
            />
            <View style={styles.renameActions}>
              <TouchableOpacity
                style={[styles.renameButton, styles.renameButtonSecondary]}
                onPress={closeRenameModal}
                activeOpacity={0.8}
              >
                <Text style={styles.renameButtonSecondaryText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.renameButton,
                  styles.renameButtonPrimary,
                  renameDraftTitle.trim().length === 0 && styles.renameButtonDisabled,
                ]}
                onPress={submitRenameChat}
                disabled={renameDraftTitle.trim().length === 0}
                activeOpacity={0.8}
              >
                <Text style={styles.renameButtonPrimaryText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={translationLanguagePicker !== null}
        animationType="fade"
        transparent
        presentationStyle="overFullScreen"
        onRequestClose={() => setTranslationLanguagePicker(null)}
      >
        <View style={styles.renameModalScreen}>
          <Pressable
            style={StyleSheet.absoluteFillObject}
            onPress={() => setTranslationLanguagePicker(null)}
          />
          <View style={styles.renameCard}>
            <Text style={styles.renameTitle}>
              {translationLanguagePicker === "source"
                ? "Select source language"
                : "Select target language"}
            </Text>
            <View style={styles.translationLanguageListContainer}>
              <FlatList
                data={
                  translationLanguagePicker === "source"
                    ? TRANSLATION_SOURCE_LANGUAGE_OPTIONS
                    : TRANSLATION_TARGET_LANGUAGE_OPTIONS
                }
                keyExtractor={(item) => item}
                style={styles.translationLanguageList}
                contentContainerStyle={styles.translationLanguageListContent}
                keyboardShouldPersistTaps="handled"
                scrollEventThrottle={16}
                onLayout={(event) => {
                  updateTranslationLanguageListScrollHint({
                    layoutHeight: event.nativeEvent.layout.height,
                  });
                }}
                onContentSizeChange={(_, height) => {
                  updateTranslationLanguageListScrollHint({
                    contentHeight: height,
                  });
                }}
                onScroll={(event) => {
                  updateTranslationLanguageListScrollHint({
                    offsetY: event.nativeEvent.contentOffset.y,
                  });
                }}
                renderItem={({ item }) => {
                  const selected = translationLanguagePicker === "source"
                    ? translationSettings.sourceLanguage === item
                    : translationSettings.targetLanguage === item;

                  return (
                    <TouchableOpacity
                      style={styles.translationLanguageRow}
                      onPress={() => selectTranslationLanguage(item)}
                      activeOpacity={0.8}
                    >
                      <Text
                        style={[
                          styles.translationLanguageText,
                          selected && styles.translationLanguageTextActive,
                        ]}
                      >
                        {TRANSLATION_LANGUAGE_LABELS[item]}
                      </Text>
                      {selected ? (
                        <Ionicons
                          name="checkmark"
                          size={18}
                          color={colors.accent}
                        />
                      ) : null}
                    </TouchableOpacity>
                  );
                }}
              />
              {translationLanguageListCanScrollDown ? (
                <View
                  pointerEvents="none"
                  style={styles.translationLanguageMoreIndicator}
                >
                  <Ionicons
                    name="chevron-down"
                    size={18}
                    color={colors.textTertiary}
                  />
                </View>
              ) : null}
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={fileVaultVisible}
        animationType="slide"
        transparent
        presentationStyle="overFullScreen"
        onRequestClose={closeFileVault}
      >
        <View style={styles.modalScreen}>
          <SafeAreaProvider>
            <FileVaultScreen
              activeSourceIds={draftSourceIds}
              onClose={closeFileVault}
              onUpload={handleUploadToFileVault}
              onDeleteSource={handleDeleteIndexedSource}
              onToggleSource={toggleSourceForActiveChat}
            />
          </SafeAreaProvider>
        </View>
      </Modal>

      {/* Model Catalog Modal */}
      <Modal
        visible={modelCatalogVisible}
        animationType="slide"
        transparent
        presentationStyle="overFullScreen"
        onRequestClose={closeModelCatalog}
      >
        <View style={styles.modalScreen}>
          <SafeAreaProvider>
            {modelCatalogVisible && (
              <ModelCatalogScreen
                onChatModelsChanged={bumpModelInventoryVersion}
                onChatModeSelected={openChatMode}
                onClose={closeModelCatalog}
                initialTab={catalogInitialTabRef.current}
                onTranslationModeSelected={openTranslationMode}
              />
            )}
          </SafeAreaProvider>
        </View>
      </Modal>

      <View style={styles.drawerShell}>
        <Sidebar
          width={sidebarWidth}
          visible={sidebarOpen}
          chats={chatSummaries}
          activeChatId={activeChatId}
          onNewChat={newChat}
          onSelectChat={selectChat}
          onDeleteChat={deleteChat}
          onRenameChat={openRenameModal}
          onOpenTensorChat={openChatMode}
          onOpenFileVault={openFileVault}
          onOpenTranslation={openTranslationMode}
          onOpenModelCatalog={openDefaultModelCatalog}
          onManageModels={openManageModels}
          onDeleteAllChats={deleteAllChats}
          activeMode={activeChatMode}
          onClose={closeSidebar}
        />

        <Animated.View
          style={[
            styles.mainPane,
            sidebarOpen && styles.mainPaneOpen,
            { transform: [{ translateX: drawerTranslateX }] },
          ]}
        >
          <KeyboardAvoidingView
            behavior="padding"
            pointerEvents={sidebarOpen ? "none" : "auto"}
            style={styles.container}
            keyboardVerticalOffset={-insets.bottom}
          >
            <View style={{ flex: 1 }}>
              {activeError || voiceStatusText ? (
                <View style={styles.errorBar}>
                  <Text style={styles.errorText}>
                    {voiceStatusText ?? activeError ?? "Connection failed. Please try again."}
                  </Text>
                </View>
              ) : null}

              {messages.length === 0 ? (
                <ChatEmptyState
                  topInset={insets.top}
                  mode={activeChatMode}
                  isIncognito={isIncognitoActive}
                  isModelReady={!!activeLoadedModelPath}
                  isModelLoading={isModelLoading}
                />
              ) : (
                <FlatList
                  ref={flatListRef}
                  data={messages}
                  renderItem={renderItem}
                  keyExtractor={keyExtractor}
                  style={styles.flatList}
                  contentContainerStyle={[
                    styles.messageList,
                    {
                      paddingTop: insets.top + 56,
                      paddingBottom: SPACING.md,
                    },
                  ]}
                  keyboardDismissMode="interactive"
                  keyboardShouldPersistTaps="handled"
                  scrollEventThrottle={16}
                  onScroll={({ nativeEvent }) => {
                    const { contentOffset, contentSize, layoutMeasurement } =
                      nativeEvent;
                    contentHeightRef.current = contentSize.height;
                    layoutHeightRef.current = layoutMeasurement.height;
                    const distanceFromBottom =
                      contentSize.height -
                      (contentOffset.y + layoutMeasurement.height);
                    const atBottom = distanceFromBottom < 120;
                    isAtBottomRef.current = atBottom;
                    setIsAtBottom(atBottom);
                  }}
                  onContentSizeChange={(_w, h) => {
                    contentHeightRef.current = h;
                    const lastMsg = messages[messages.length - 1];
                    // Keep following layout growth while user is at bottom.
                    // This catches post-stream additions like the copy button.
                    const shouldAutoScroll =
                      !lastMsg?.isStreaming
                      && (lastMsg?.content === "" || isAtBottomRef.current);
                    if (shouldAutoScroll) {
                      scheduleScrollToEnd(false);
                    }
                  }}
                />
              )}

              {/* Scroll to bottom button */}
              {!isAtBottom &&
                (isLiquidGlassAvailable() ? (
                  <GlassView isInteractive style={styles.scrollToBottomBtn}>
                    <TouchableOpacity
                      style={styles.scrollToBottomBtnInner}
                      onPress={() => {
                        scheduleScrollToEnd(true);
                        setIsAtBottom(true);
                      }}
                      activeOpacity={0.8}
                    >
                      <Ionicons
                        name="arrow-down"
                        size={18}
                        color={colors.textPrimary}
                      />
                    </TouchableOpacity>
                  </GlassView>
                ) : (
                  <TouchableOpacity
                    style={[
                      styles.scrollToBottomBtn,
                      styles.scrollToBottomBtnSolid,
                    ]}
                    onPress={() => {
                      scheduleScrollToEnd(true);
                      setIsAtBottom(true);
                    }}
                    activeOpacity={0.8}
                  >
                    <Ionicons
                      name="arrow-down"
                      size={18}
                      color={colors.textPrimary}
                    />
                  </TouchableOpacity>
                ))}
            </View>

            {/* Backdrop to dismiss attach menu */}
            {attachMenuOpen && (
              <TouchableOpacity
                style={StyleSheet.absoluteFillObject}
                activeOpacity={1}
                onPress={closeAttachMenu}
              />
            )}

            <ChatInput
              inputRef={inputRef}
              mode={activeChatMode}
              inputText={inputText}
              onChangeText={setInputText}
              onOpenModelCatalog={openCurrentModeModelCatalog}
              onSend={sendMessage}
              onStop={handleStopGeneration}
              onFocus={handleInputFocus}
              isGenerating={isGenerating}
              isLoading={isModelLoading}
              loadedModelPath={activeLoadedModelPath}
              isCompressingImage={isCompressingImage}
              pendingImageUri={isTranslationMode ? null : pendingImageUri}
              pendingImageDisplayUri={
                isTranslationMode ? null : pendingImageDisplayUri
              }
              onClearImage={handleClearImage}
              attachMenuOpen={attachMenuOpen}
              attachMenuAnim={attachMenuAnim}
              onAttachOpen={openAttachMenu}
              onAttachClose={closeAttachMenu}
              onPickCamera={pickFromCamera}
              onPickLibrary={pickFromLibrary}
              onPickDocument={handlePickDocument}
              isFileAttachmentDisabled={draftSourceIds.length >= MAX_ATTACHED_SOURCES}
              reasoningEnabled={reasoningEnabled}
              modelSupportsThinking={modelSupportsThinking}
              modelSupportsVision={modelSupportsVision}
              onToggleReasoning={toggleReasoning}
              webSearchEnabled={webSearchEnabled}
              onToggleWebSearch={toggleWebSearch}
              webSearchTemporarilyDisabled={!!pendingImageUri}
              modelSupportsWebSearch={modelSupportsWebSearch}
              translationSourceLabel={
                TRANSLATION_LANGUAGE_LABELS[translationSettings.sourceLanguage]
              }
              translationTargetLabel={
                TRANSLATION_LANGUAGE_LABELS[translationSettings.targetLanguage]
              }
              translationCanSwap={true}
              onPressTranslationSource={handlePressTranslationSource}
              onPressTranslationTarget={handlePressTranslationTarget}
              onSwapTranslationLanguages={swapTranslationLanguages}
              attachedSources={isTranslationMode ? [] : attachedSources}
              onRemoveSource={handleRemoveAttachedSource}
              sourceStatusText={
                !isTranslationMode && isEmbeddingModelEnabled
                  ? fileRagStatusMessage
                  : null
              }
              voiceAvailable={voiceAvailable}
              isRecordingVoice={isRecordingVoice}
              isRecordingPaused={isRecordingPaused}
              isTranscribingVoice={isTranscribingVoice}
              isPreparingVoice={isPreparingVoice}
              onVoicePress={handleVoicePress}
              onPauseResumeRecording={handlePauseResumeRecording}
              onTranscribeAndExit={handleTranscribeAndExit}
              onDisableVoiceMode={disableVoiceMode}
              bottomInset={insets.bottom}
            />
          </KeyboardAvoidingView>

          <ChatHeader
            isLoading={isModelLoading}
            isGenerating={isGenerating}
            incognitoActive={isIncognitoActive}
            loadedModelName={loadedModelName}
            modelPickerVisible={modelPickerVisible}
            chevronAnim={chevronAnim}
            modelPillRef={modelPillRef}
            topInset={insets.top}
            onMenuPress={openSidebar}
            onModelPillPress={handleShowModelPicker}
            onStartIncognitoChat={startIncognitoChat}
            onNewChat={newChat}
          />

          {sidebarOpen ? (
            <>
              <Animated.View
                pointerEvents="none"
                style={[
                  StyleSheet.absoluteFillObject,
                  styles.mainPaneOverlay,
                  { opacity: drawerOverlayOpacity },
                ]}
              />
              <Pressable
                style={[StyleSheet.absoluteFillObject, styles.mainPaneBlocker]}
                onPress={closeSidebar}
              />
            </>
          ) : null}
        </Animated.View>
      </View>

      <ModelPickerDropdown
        visible={modelPickerVisible}
        mode={activeChatMode}
        onClose={handleHideModelPicker}
        onOpenModelCatalog={openCurrentModeModelCatalog}
        anchorRef={modelPillRef}
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
    renameModalScreen: {
      flex: 1,
      backgroundColor: colors.overlayBg,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: SPACING.lg,
    },
    renameCard: {
      width: "100%",
      maxWidth: 360,
      borderRadius: 20,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      padding: SPACING.lg,
      gap: SPACING.md,
    },
    renameTitle: {
      fontSize: 18,
      fontWeight: "600",
      color: colors.textPrimary,
    },
    renameInput: {
      borderRadius: RADII.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.base,
      color: colors.textPrimary,
      fontSize: 16,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.md,
    },
    translationLanguageList: {
      maxHeight: 320,
    },
    translationLanguageListContainer: {
      gap: SPACING.xs,
    },
    translationLanguageListContent: {
      paddingBottom: SPACING.xs,
    },
    translationLanguageRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: SPACING.sm + 2,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    translationLanguageMoreIndicator: {
      alignItems: "center",
      justifyContent: "center",
      paddingTop: 2,
    },
    translationLanguageText: {
      fontSize: 15,
      color: colors.textSecondary,
    },
    translationLanguageTextActive: {
      color: colors.textPrimary,
      fontWeight: "600",
    },
    renameActions: {
      flexDirection: "row",
      justifyContent: "flex-end",
      gap: SPACING.sm,
    },
    renameButton: {
      minWidth: 84,
      paddingHorizontal: SPACING.md,
      paddingVertical: 10,
      borderRadius: RADII.pill,
      alignItems: "center",
      justifyContent: "center",
    },
    renameButtonPrimary: {
      backgroundColor: colors.accent,
    },
    renameButtonSecondary: {
      backgroundColor: colors.base,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    renameButtonDisabled: {
      opacity: 0.45,
    },
    renameButtonPrimaryText: {
      color: "#FFFFFF",
      fontSize: 15,
      fontWeight: "600",
    },
    renameButtonSecondaryText: {
      color: colors.textSecondary,
      fontSize: 15,
      fontWeight: "600",
    },
    modalScreen: {
      flex: 1,
      backgroundColor: colors.base,
    },
    drawerShell: {
      flex: 1,
      backgroundColor: colors.sidebar,
      overflow: "hidden",
    },
    container: {
      flex: 1,
      backgroundColor: colors.base,
    },
    mainPane: {
      flex: 1,
      backgroundColor: colors.base,
      zIndex: 2,
    },
    mainPaneOpen: {
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.2,
      shadowRadius: 18,
      elevation: 18,
    },
    mainPaneOverlay: {
      backgroundColor: colors.overlayBg,
      zIndex: 30,
    },
    mainPaneBlocker: {
      zIndex: 31,
    },
    errorBar: {
      backgroundColor: colors.errorBarBg,
      paddingHorizontal: SPACING.lg,
      paddingVertical: SPACING.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.errorBarBorder,
    },
    errorText: {
      color: colors.errorText,
      fontSize: 13,
    },
    flatList: {
      flex: 1,
      backgroundColor: colors.base,
    },
    messageList: {
      paddingTop: 72,
      paddingBottom: SPACING.sm,
      flexGrow: 1,
    },
    scrollToBottomBtn: {
      position: "absolute",
      bottom: SPACING.sm,
      left: "50%",
      marginLeft: -18,
      width: 36,
      height: 36,
      borderRadius: 18,
      overflow: "hidden",
      zIndex: 5,
    },
    scrollToBottomBtnInner: {
      width: 36,
      height: 36,
      alignItems: "center",
      justifyContent: "center",
    },
    scrollToBottomBtnSolid: {
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.18,
      shadowRadius: 6,
      elevation: 4,
    },
  });
}
