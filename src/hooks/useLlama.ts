import { useState, useCallback, useRef, useMemo } from "react";
import { DEFAULT_THINKING_BUDGET, type ThinkingBudget } from "../constants/models";
import {
  combineReasoningAndResponse,
  parseThinking,
  stripThinkingTags,
} from "../utils/reasoning";
import { optionalRequire } from "../utils/optionalRequire";

// Gracefully handle environments where llama.rn is not fully available
let initLlama:
  | ((params: {
      model: string;
      n_ctx?: number;
      n_threads?: number;
      n_gpu_layers?: number;
      use_mmap?: boolean;
      flash_attn_type?: string;
      cache_type_k?: string;
      cache_type_v?: string;
    }) => Promise<LlamaContext>)
  | null = null;
let releaseAllLlama: (() => Promise<void>) | null = null;

const llamaModule = optionalRequire<{
  initLlama: typeof initLlama;
  releaseAllLlama: typeof releaseAllLlama;
}>(() => require("llama.rn"));

if (llamaModule) {
  initLlama = llamaModule.initLlama;
  releaseAllLlama = llamaModule.releaseAllLlama;
} else {
  console.warn("llama.rn not available in this environment");
}

// Structured message content for multi-modal (vision) inputs
export type MessageContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface LlamaToolDefinition {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

export interface LlamaToolCall {
  type: "function";
  id?: string;
  function: {
    name: string;
    arguments: string;
  };
}

export type StructuredMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | MessageContentPart[];
  reasoning_content?: string;
  tool_call_id?: string;
  tool_calls?: LlamaToolCall[];
};

export type StructuredMessages = StructuredMessage[];

interface LlamaFormattedChatResult {
  type: "jinja" | "llama-chat";
  prompt: string;
  has_media: boolean;
  media_paths?: string[];
  chat_format?: number;
  grammar?: string;
  grammar_lazy?: boolean;
  grammar_triggers?: Array<{
    type: number;
    value: string;
    token: number;
  }>;
  thinking_forced_open?: boolean;
  preserved_tokens?: string[];
  additional_stops?: string[];
  chat_parser?: string;
}

interface LlamaContext {
  getFormattedChat: (
    messages: StructuredMessages,
    template?: string | null,
    params?: {
      jinja?: boolean;
      tools?: LlamaToolDefinition[];
      parallel_tool_calls?: boolean;
      tool_choice?: string;
      enable_thinking?: boolean;
      reasoning_format?: "none" | "auto" | "deepseek";
      chat_template_kwargs?: Record<string, string | boolean | number>;
    },
  ) => Promise<LlamaFormattedChatResult>;
  completion: (
    params: {
      prompt?: string;
      messages?: StructuredMessages;
      n_predict?: number;
      temperature?: number;
      top_p?: number;
      top_k?: number;
      min_p?: number;
      presence_penalty?: number;
      repeat_penalty?: number;
      stop?: string[];
      enable_thinking?: boolean;
      jinja?: boolean;
      reasoning_format?: "none" | "auto" | "deepseek";
      chat_template_kwargs?: Record<string, string | boolean | number>;
      tools?: LlamaToolDefinition[];
      parallel_tool_calls?: boolean;
      tool_choice?: string;
    },
    callback?: (data: LlamaTokenData) => void,
  ) => Promise<LlamaCompletionResult>;
  stopCompletion: () => Promise<void>;
  tokenize: (text: string, options?: { media_paths?: string[] }) => Promise<{
    tokens: number[];
    has_media: boolean;
    bitmap_hashes: number[];
    chunk_pos: number[];
    chunk_pos_media: number[];
  }>;
  release: () => Promise<void>;
  initMultimodal: (params: {
    path: string;
    use_gpu: boolean;
  }) => Promise<boolean>;
  isMultimodalEnabled: () => Promise<boolean>;
  releaseMultimodal: () => Promise<void>;
}

interface LlamaTokenData {
  token?: string;
  content?: string;
  reasoning_content?: string;
  accumulated_text?: string;
  tool_calls?: LlamaToolCall[];
}

interface LlamaCompletionResult {
  text: string;
  content?: string;
  reasoning_content?: string;
  tool_calls?: LlamaToolCall[];
}

export interface UseLlamaReturn {
  isLoading: boolean;
  isGenerating: boolean;
  loadedModelPath: string | null;
  loadedContextSize: number | null;
  multimodalEnabled: boolean;
  loadedMmprojPath: string | null;
  error: string | null;
  isTranslationLoading: boolean;
  isTranslationGenerating: boolean;
  loadedTranslationModelPath: string | null;
  translationError: string | null;
  loadModel: (
    modelPath: string,
    mmprojPath?: string,
    options?: LlamaLoadOptions,
  ) => Promise<boolean>;
  unloadModel: () => Promise<void>;
  loadTranslationModel: (modelPath: string) => Promise<boolean>;
  unloadTranslationModel: () => Promise<void>;
  generateResponse: (
    promptOrMessages: string | StructuredMessages,
    onToken?: (data: LlamaStreamUpdate) => void,
    options?: LlamaGenerationOptions,
  ) => Promise<LlamaGenerationResult>;
  generateTranslation: (
    prompt: string,
    onToken?: (data: LlamaStreamUpdate) => void,
    options?: LlamaTranslationGenerationOptions,
  ) => Promise<LlamaGenerationResult>;
  countPromptTokens: (
    promptOrMessages: string | StructuredMessages,
    options?: LlamaPromptTokenCountOptions,
  ) => Promise<number | null>;
  stopGeneration: () => Promise<void>;
  stopTranslationGeneration: () => Promise<void>;
}

export interface LlamaGenerationOptions {
  thinking?: boolean;
  alwaysThinks?: boolean;
  nativeReasoning?: boolean;
  thinkingBudget?: ThinkingBudget;
  tools?: LlamaToolDefinition[];
  toolChoice?: string;
  /**
   * Override the per-call output token cap (`n_predict`). When omitted, the
   * value is derived from `getGenerationTokenBudget` (DEFAULT_GENERATION_TOKENS
   * for non-thinking mode, or the thinking-budget value). Callers that need
   * more output room (e.g. Mini Apps generating full html/css/js in one
   * tool-call) can pass a larger value here.
   */
  maxGenerationTokens?: number;
}

export interface LlamaLoadOptions {
  /**
   * Context window size passed to `initLlama` as `n_ctx`. Defaults to 8192
   * which fits most chat use cases in ~512 MB–1 GB of KV cache RAM. Mini
   * Apps mode bumps this to 16384 to make room for a system prompt that
   * injects the current app code plus grammar-constrained tool output.
   */
  contextSize?: number;
}

export interface LlamaPromptTokenCountOptions {
  thinking?: boolean;
  tools?: LlamaToolDefinition[];
  toolChoice?: string;
}

export interface LlamaTranslationGenerationOptions {
  maxGenerationTokens?: number;
  stop?: string[];
}

// Raw output including <think>...</think> tags — parsed at render time (private-mind pattern)
export interface LlamaStreamUpdate {
  content: string;
  responseContent: string;
  reasoningContent: string;
  combinedContent: string;
  reasoningTokenCount: number;
  toolCalls: LlamaToolCall[];
}

export interface LlamaGenerationResult {
  content: string;
  responseContent: string;
  reasoningContent: string;
  combinedContent: string;
  reasoningTokenCount: number;
  toolCalls: LlamaToolCall[];
}

const DEFAULT_GENERATION_TOKENS = 1024;
const REASONING_TOKEN_VERIFICATION_WINDOW = 32;

function isThinkBoundaryOnlyToken(token: string): boolean {
  return (/<\s*\/?\s*think\s*>/i.test(token) || /<\|channel>thought/i.test(token) || /<channel\|>/i.test(token))
    && stripThinkingTags(token).trim().length === 0;
}

function normalizeReasoningText(reasoningText: string): string {
  return reasoningText.trim();
}

function sanitizeTranslationResponse(text: string): string {
  return text
    .replace(/<start_of_turn>model\s*/gi, "")
    .replace(/<\|im_start\|>assistant\s*/gi, "")
    .replace(/<end_of_turn>[\s\S]*$/gi, "")
    .replace(/<\|im_end\|>[\s\S]*$/gi, "")
    .trim();
}

function buildGenerationSnapshot(
  reasoningContent: string,
  responseContent: string,
  reasoningTokenCount: number,
  toolCalls: LlamaToolCall[] = [],
): LlamaGenerationResult {
  const combinedContent = combineReasoningAndResponse(
    reasoningContent,
    responseContent,
  );
  const cleanedResponse = stripThinkingTags(responseContent).trim();
  const parsedCombined = parseThinking(combinedContent);

  return {
    content: cleanedResponse,
    responseContent: cleanedResponse,
    reasoningContent: parsedCombined.thinking ?? "",
    combinedContent,
    reasoningTokenCount,
    toolCalls,
  };
}

function normalizeToolCalls(toolCalls: unknown): LlamaToolCall[] {
  if (!Array.isArray(toolCalls)) {
    return [];
  }

  return toolCalls.flatMap((toolCall) => {
    if (!toolCall || typeof toolCall !== "object") {
      return [];
    }

    const candidate = toolCall as Partial<LlamaToolCall>;
    if (
      candidate.type !== "function"
      || !candidate.function
      || typeof candidate.function.name !== "string"
      || typeof candidate.function.arguments !== "string"
    ) {
      return [];
    }

    return [{
      type: "function",
      ...(typeof candidate.id === "string" ? { id: candidate.id } : {}),
      function: {
        name: candidate.function.name,
        arguments: candidate.function.arguments,
      },
    }];
  });
}

/**
 * Parse tool calls from raw text for models that emit tool calls as markup
 * rather than structured data. Supports:
 *   - Function syntax: <|tool_call_start|>[fn_name(key="value", ...)]<|tool_call_end|>
 *   - JSON syntax:     <|tool_call_start|>{"name":"fn","arguments":{...}}<|tool_call_end|>
 *   - Gemma 4 syntax:  <|tool_call>{"name":"fn","arguments":{...}}<tool_call|>
 */
const RAW_TOOL_CALL_BLOCK_PATTERNS = [
  /<\|tool_call_start\|>([\s\S]*?)<\|tool_call_end\|>/g,
  /<\|tool_call>([\s\S]*?)<tool_call\|>/g,
];
const FUNCTION_CALL_PATTERN = /^\s*\[(\w+)\(([^)]*)\)\]\s*$/;

function parseToolCallsFromRawText(rawText: string): LlamaToolCall[] {
  const calls: LlamaToolCall[] = [];

  for (const pattern of RAW_TOOL_CALL_BLOCK_PATTERNS) {
    // Reset lastIndex for each pattern since they have the global flag
    pattern.lastIndex = 0;
    for (const blockMatch of rawText.matchAll(pattern)) {
      const body = (blockMatch[1] ?? "").trim();
      if (!body) continue;

      // Try JSON format first: {"name":"fn","arguments":{...}}
      const jsonCall = tryParseJsonToolCall(body);
      if (jsonCall) {
        calls.push(jsonCall);
        continue;
      }

      // Try function-call syntax: [fn_name(key="value", ...)]
      const fnMatch = body.match(FUNCTION_CALL_PATTERN);
      if (fnMatch && fnMatch[1]) {
        const fnName = fnMatch[1];
        const argsString = fnMatch[2] ?? "";
        const argsObj: Record<string, unknown> = {};
        const argPattern = /(\w+)\s*=\s*(?:"([^"]*)"|(\d+(?:\.\d+)?))/g;
        for (const argMatch of argsString.matchAll(argPattern)) {
          const key = argMatch[1];
          if (!key) continue;
          if (argMatch[2] !== undefined) {
            argsObj[key] = argMatch[2];
          } else if (argMatch[3] !== undefined) {
            argsObj[key] = Number(argMatch[3]);
          }
        }
        calls.push({
          type: "function",
          function: { name: fnName, arguments: JSON.stringify(argsObj) },
        });
      }
    }
  }

  return calls;
}

function tryParseJsonToolCall(body: string): LlamaToolCall | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") return null;

  const obj = parsed as Record<string, unknown>;

  // Format: {"name":"fn","arguments":{...}} or {"name":"fn","parameters":{...}}
  const name = typeof obj.name === "string" ? obj.name : undefined;
  const args = obj.arguments ?? obj.parameters;

  if (!name) return null;

  const argsStr = typeof args === "string"
    ? args
    : args && typeof args === "object"
      ? JSON.stringify(args)
      : "{}";

  return {
    type: "function",
    function: { name, arguments: argsStr },
  };
}

function getToolCallMergeKey(toolCall: LlamaToolCall): string {
  const normalizedArguments = toolCall.function.arguments.trim();

  return toolCall.id
    ? `id:${toolCall.id}`
    : `call:${toolCall.function.name}:${normalizedArguments}`;
}

function mergeToolCalls(
  previousCalls: LlamaToolCall[],
  incomingCalls: LlamaToolCall[],
): LlamaToolCall[] {
  if (incomingCalls.length === 0) {
    return previousCalls;
  }

  const nextCalls = new Map<string, LlamaToolCall>();
  [...previousCalls, ...incomingCalls].forEach((toolCall) => {
    const key = getToolCallMergeKey(toolCall);
    nextCalls.set(key, toolCall);
  });

  return Array.from(nextCalls.values());
}

function hasImageMessages(messages: StructuredMessages): boolean {
  return messages.some(
    (message) => Array.isArray(message.content)
      && message.content.some((part) => part.type === "image_url"),
  );
}

function buildMessageFormattingParams(
  messages: StructuredMessages,
  options?: LlamaPromptTokenCountOptions & { alwaysThinks?: boolean; nativeReasoning?: boolean },
): {
  jinja: true;
  enable_thinking: boolean;
  reasoning_format: "none" | "auto";
  chat_template_kwargs?: Record<string, string | boolean | number>;
  tools?: LlamaToolDefinition[];
  tool_choice?: string;
  parallel_tool_calls?: boolean;
} {
  const thinking = options?.thinking ?? false;
  const alwaysThinks = options?.alwaysThinks ?? false;
  const nativeReasoning = options?.nativeReasoning ?? false;
  const hasImage = hasImageMessages(messages);
  const needsReasoningFormat = thinking || alwaysThinks;

  // Explicitly pass enable_thinking through BOTH the top-level
  // `enable_thinking` flag AND the Jinja `chat_template_kwargs`.
  //
  // Why both: some model templates (Qwen 3.5) read `enable_thinking`
  // from the template kwargs rather than from the top-level flag.
  // Without this, the template opens a `<think>` block even when
  // `enable_thinking: false` is set at the top level, causing the
  // model to waste its entire output budget on reasoning tokens
  // instead of producing the tool call. This was observed in
  // production with Qwen 3.5 4B on the mini-app builder — the model
  // burned 180s of inference time on thinking and never emitted a
  // tool call.
  const enableThinking =
    hasImage || alwaysThinks ? false : needsReasoningFormat;

  return {
    jinja: true,
    enable_thinking: enableThinking,
    // Only pass chat_template_kwargs when we're SUPPRESSING thinking.
    // Some templates (Qwen 3.5) read `enable_thinking` from kwargs
    // instead of the top-level flag — without this kwarg, Qwen opens
    // a <think> block and wastes the entire output budget on reasoning.
    //
    // We DON'T pass the kwarg when thinking is enabled because some
    // templates (Gemma 4) don't expect it and may produce empty or
    // malformed output when they see an unrecognized kwarg.
    ...(enableThinking
      ? {}
      : { chat_template_kwargs: { enable_thinking: false } }),
    // Models with nativeReasoning (e.g. Gemma 4) or alwaysThinks (e.g. LFM
    // 1.2B Thinking) handle thinking via their template natively — using
    // reasoning_format "auto" would generate a GBNF grammar that conflicts
    // with their native thinking tokens, causing generation to hang.
    reasoning_format: hasImage || nativeReasoning || alwaysThinks
      ? ("none" as const)
      : needsReasoningFormat
        ? ("auto" as const)
        : ("none" as const),
    // Don't pass tools to llama.rn for models that always think —
    // the GBNF grammar llama.rn generates for tool calls blocks the
    // <think> tokens the model always produces, causing generation to
    // hang. Tool definitions are added to the system prompt instead,
    // and parseToolCallsFromRawText handles parsing.
    ...(options?.tools && options.tools.length > 0 && !alwaysThinks
      ? {
          tools: options.tools,
          tool_choice: options.toolChoice ?? "auto",
          parallel_tool_calls: false,
        }
      : {}),
  };
}

export function getGenerationTokenBudget(
  isMessages: boolean,
  thinking: boolean,
  thinkingBudget?: ThinkingBudget,
): number {
  if (isMessages || !thinking) {
    return DEFAULT_GENERATION_TOKENS;
  }

  return Math.max(
    DEFAULT_GENERATION_TOKENS,
    thinkingBudget?.maxGenerationTokens ?? DEFAULT_THINKING_BUDGET.maxGenerationTokens,
  );
}

export function useLlama(): UseLlamaReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [loadedModelPath, setLoadedModelPath] = useState<string | null>(null);
  const [loadedContextSize, setLoadedContextSize] = useState<number | null>(null);
  const [multimodalEnabled, setMultimodalEnabled] = useState(false);
  const [loadedMmprojPath, setLoadedMmprojPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isTranslationLoading, setIsTranslationLoading] = useState(false);
  const [isTranslationGenerating, setIsTranslationGenerating] = useState(false);
  const [loadedTranslationModelPath, setLoadedTranslationModelPath] = useState<string | null>(null);
  const [translationError, setTranslationError] = useState<string | null>(null);

  const contextRef = useRef<LlamaContext | null>(null);
  const isStoppedRef = useRef(false);
  const mmprojPathRef = useRef<string | null>(null);
  const multimodalEnabledRef = useRef(false);
  const translationContextRef = useRef<LlamaContext | null>(null);
  const translationStoppedRef = useRef(false);
  /**
   * Guard against `loadModel` racing with an in-flight `generateResponse`.
   * Set to true at the start of `loadModel` (before releasing the context)
   * and cleared when loading finishes. `generateResponse` refuses to start
   * while this is true, and existing completions are stopped before the
   * load proceeds. Prevents the "stale contextRef during load" crash that
   * can happen when the miniapp mode-switch effect fires during a slow
   * initial build.
   */
  const contextBusyRef = useRef(false);

  const releaseContext = useCallback(async (context: LlamaContext | null) => {
    if (!context) {
      return;
    }

    try {
      await context.releaseMultimodal();
    } catch {}

    await context.release();
  }, []);

  const releaseAllIfIdle = useCallback(async () => {
    if (
      !contextRef.current
      && !translationContextRef.current
      && releaseAllLlama
    ) {
      await releaseAllLlama();
    }
  }, []);

  const loadModel = useCallback(
    async (
      modelPath: string,
      mmprojPath?: string,
      options?: LlamaLoadOptions,
    ) => {
      if (!initLlama) {
        setError("llama.rn is not available on this platform");
        return false;
      }

      setIsLoading(true);
      setError(null);
      // Mark context busy BEFORE releasing anything so a racing
      // generateResponse call refuses to start instead of trying to use
      // the soon-to-be-freed context.
      contextBusyRef.current = true;
      // Nudge any in-flight generation to stop so the release below
      // doesn't tear out a context that's still being read.
      try {
        if (contextRef.current) {
          isStoppedRef.current = true;
          await contextRef.current.stopCompletion();
        }
      } catch {}

      try {
        // Chat and translation runtimes are mutually exclusive.
        if (translationContextRef.current) {
          await releaseContext(translationContextRef.current);
          translationContextRef.current = null;
        }
        setLoadedTranslationModelPath(null);
        setTranslationError(null);

        // Release any previously loaded chat model.
        if (contextRef.current) {
          await releaseContext(contextRef.current);
          contextRef.current = null;
        }
        setMultimodalEnabled(false);
        setLoadedMmprojPath(null);
        setLoadedContextSize(null);

        // Default 8192-token context window fits most chat use cases in
        // ~512 MB–1 GB of KV cache RAM. Callers can request a larger window
        // (e.g. Mini Apps mode passes 16384 so the system prompt injection +
        // tool-grammar overhead + app-code output all fit comfortably).
        const contextSize = options?.contextSize ?? 8192;
        const ctx = await initLlama({
          model: modelPath,
          n_ctx: contextSize,
          n_threads: 4,
        });

        contextRef.current = ctx;
        setLoadedModelPath(modelPath);
        setLoadedContextSize(contextSize);

        console.log(
          "[LLM] loadModel — mmprojPath received:",
          mmprojPath ?? "none",
        );

        // Store mmproj path for lazy init on first vision message.
        // We intentionally do NOT eagerly call initMultimodal() here
        // because it loads the full mmproj file into memory (~0.65 GB+),
        // which on RAM-constrained devices (6 GB) can push total memory
        // past the iOS jetsam limit and crash the app on launch. The
        // lazy init path in generateResponse() handles loading on-demand
        // when the user actually sends an image.
        if (mmprojPath) {
          mmprojPathRef.current = mmprojPath;
          setLoadedMmprojPath(mmprojPath);
        } else {
          mmprojPathRef.current = null;
        }
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(`Failed to load model: ${message}`);
        setLoadedModelPath(null);
        setLoadedContextSize(null);
        setMultimodalEnabled(false);
        multimodalEnabledRef.current = false;
        setLoadedMmprojPath(null);
        mmprojPathRef.current = null;
        contextRef.current = null;
        return false;
      } finally {
        setIsLoading(false);
        contextBusyRef.current = false;
      }
    },
    [releaseContext],
  );

  const unloadModel = useCallback(async () => {
    try {
      if (contextRef.current) {
        await releaseContext(contextRef.current);
        contextRef.current = null;
      }
      await releaseAllIfIdle();
      setLoadedModelPath(null);
      setLoadedContextSize(null);
      setMultimodalEnabled(false);
      multimodalEnabledRef.current = false;
      setLoadedMmprojPath(null);
      mmprojPathRef.current = null;
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(`Failed to unload model: ${message}`);
    }
  }, [releaseAllIfIdle, releaseContext]);

  const loadTranslationModel = useCallback(async (modelPath: string) => {
    if (!initLlama) {
      setTranslationError("llama.rn is not available on this platform");
      return false;
    }

    setIsTranslationLoading(true);
    setTranslationError(null);
    contextBusyRef.current = true;

    // Stop any in-flight chat generation before releasing the context.
    try {
      if (contextRef.current) {
        isStoppedRef.current = true;
        await contextRef.current.stopCompletion();
      }
    } catch {}

    try {
      // Chat and translation runtimes are mutually exclusive.
      if (contextRef.current) {
        await releaseContext(contextRef.current);
        contextRef.current = null;
      }
      setLoadedModelPath(null);
      setLoadedContextSize(null);
      setMultimodalEnabled(false);
      multimodalEnabledRef.current = false;
      setLoadedMmprojPath(null);
      mmprojPathRef.current = null;
      setError(null);

      if (translationContextRef.current) {
        await releaseContext(translationContextRef.current);
        translationContextRef.current = null;
      }
      setLoadedTranslationModelPath(null);

      const contextSize = 4096;
      const ctx = await initLlama({
        model: modelPath,
        n_ctx: contextSize,
        n_threads: 4,
      });

      translationContextRef.current = ctx;
      setLoadedTranslationModelPath(modelPath);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setTranslationError(`Failed to load translation model: ${message}`);
      setLoadedTranslationModelPath(null);
      translationContextRef.current = null;
      return false;
    } finally {
      setIsTranslationLoading(false);
      contextBusyRef.current = false;
    }
  }, [releaseContext]);

  const unloadTranslationModel = useCallback(async () => {
    try {
      if (translationContextRef.current) {
        await releaseContext(translationContextRef.current);
        translationContextRef.current = null;
      }

      await releaseAllIfIdle();
      setLoadedTranslationModelPath(null);
      setTranslationError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setTranslationError(`Failed to unload translation model: ${message}`);
    }
  }, [releaseAllIfIdle, releaseContext]);

  const stopGeneration = useCallback(async () => {
    if (!contextRef.current) return;
    isStoppedRef.current = true;
    await contextRef.current.stopCompletion();
  }, []);

  const stopTranslationGeneration = useCallback(async () => {
    if (!translationContextRef.current) return;
    translationStoppedRef.current = true;
    await translationContextRef.current.stopCompletion();
  }, []);

  const countPromptTokens = useCallback(
    async (
      promptOrMessages: string | StructuredMessages,
      options?: LlamaPromptTokenCountOptions,
    ): Promise<number | null> => {
      const context = contextRef.current;
      if (!context) {
        return null;
      }

      try {
        if (Array.isArray(promptOrMessages)) {
          const formattedChat = await context.getFormattedChat(
            promptOrMessages,
            null,
            buildMessageFormattingParams(promptOrMessages, options),
          );
          const tokenized = await context.tokenize(
            formattedChat.prompt,
            formattedChat.media_paths && formattedChat.media_paths.length > 0
              ? { media_paths: formattedChat.media_paths }
              : undefined,
          );
          return tokenized.tokens.length;
        }

        const tokenized = await context.tokenize(promptOrMessages);
        return tokenized.tokens.length;
      } catch (tokenizeErr) {
        console.warn("[LLM] failed to count prompt tokens:", tokenizeErr);
        return null;
      }
    },
    [],
  );

  const generateResponse = useCallback(
    async (
      promptOrMessages: string | StructuredMessages,
      onToken?: (data: LlamaStreamUpdate) => void,
      options?: LlamaGenerationOptions,
    ): Promise<LlamaGenerationResult> => {
      if (!contextRef.current) {
        throw new Error("No model loaded. Please load a model first.");
      }
      // Refuse to start if a loadModel is mid-flight. The old context
      // may have been released already and `contextRef.current` could
      // point at a soon-to-be-freed object. Return a clear error that
      // the harness can classify as hard-failure and bail.
      if (contextBusyRef.current) {
        throw new Error("Model is being loaded — cannot generate right now.");
      }

      setIsGenerating(true);
      setError(null);
      isStoppedRef.current = false;

      const hasTools = Array.isArray(options?.tools) && options.tools.length > 0;
      const thinking = hasTools ? false : (options?.thinking ?? false);
      const alwaysThinks = options?.alwaysThinks ?? false;
      const nativeReasoning = options?.nativeReasoning ?? false;
      const isMessages = Array.isArray(promptOrMessages);
      const useImplicitThinkOpen = thinking && !isMessages;
      const reasoningTokenLimit =
        !isMessages && thinking
          ? Math.max(
              0,
              options?.thinkingBudget?.maxReasoningTokens
                ?? DEFAULT_THINKING_BUDGET.maxReasoningTokens,
            )
          : 0;
      const shouldVerifyReasoningTokenCount = reasoningTokenLimit > 0;
      // Explicit `maxGenerationTokens` override takes priority over the
      // budget derived from thinking state. Callers (e.g. the Mini Apps
      // agent factory) need to bump this above the 1024-token default to
      // fit a full html/css/js tool call in one generation.
      const maxGenerationTokens =
        options?.maxGenerationTokens
        ?? getGenerationTokenBudget(
          isMessages,
          thinking,
          options?.thinkingBudget,
        );
      let rawAccum = "";
      let reasoningAccum = "";
      let responseAccum = "";
      let reasoningTokenCount = 0;
      let estimatedReasoningTokenCount = 0;
      let verifiedReasoningTokenCount = 0;
      let verifiedReasoningText = "";
      let useEstimatedReasoningTokenCount = !shouldVerifyReasoningTokenCount;
      let reasoningTokenVerificationPromise: Promise<void> | null = null;
      let rerunReasoningTokenVerification = false;
      let toolCallsAccum: LlamaToolCall[] = [];

      const getCurrentNormalizedReasoningText = (): string =>
        normalizeReasoningText(reasoningAccum);

      const syncReasoningTokenCount = (): void => {
        if (useEstimatedReasoningTokenCount || reasoningTokenLimit <= 0) {
          reasoningTokenCount = estimatedReasoningTokenCount;
          return;
        }

        const currentReasoningText = getCurrentNormalizedReasoningText();
        if (currentReasoningText.length === 0) {
          reasoningTokenCount = 0;
          return;
        }

        if (
          estimatedReasoningTokenCount
          < Math.max(1, reasoningTokenLimit - REASONING_TOKEN_VERIFICATION_WINDOW)
        ) {
          reasoningTokenCount = estimatedReasoningTokenCount;
          return;
        }

        if (verifiedReasoningText === currentReasoningText) {
          reasoningTokenCount = verifiedReasoningTokenCount;
          return;
        }

        reasoningTokenCount = Math.min(
          estimatedReasoningTokenCount,
          Math.max(reasoningTokenLimit - 1, 0),
        );
      };

      const verifyReasoningTokenCount = async (
        options?: { force?: boolean; emitSnapshot?: boolean },
      ): Promise<void> => {
        const force = options?.force ?? false;
        const emitSnapshot = options?.emitSnapshot ?? true;

        if (
          useEstimatedReasoningTokenCount
          || reasoningTokenLimit <= 0
          || !contextRef.current
        ) {
          return;
        }

        const normalizedReasoningText = getCurrentNormalizedReasoningText();
        const shouldVerifyNow =
          force
          || estimatedReasoningTokenCount
            >= Math.max(1, reasoningTokenLimit - REASONING_TOKEN_VERIFICATION_WINDOW);

        if (!shouldVerifyNow || normalizedReasoningText.length === 0) {
          return;
        }

        if (reasoningTokenVerificationPromise) {
          rerunReasoningTokenVerification = true;
          return;
        }

        const context = contextRef.current;
        const verificationReasoningText = normalizedReasoningText;

        reasoningTokenVerificationPromise = context
          .tokenize(verificationReasoningText)
          .then((result) => {
            if (verificationReasoningText !== getCurrentNormalizedReasoningText()) {
              rerunReasoningTokenVerification = true;
              return;
            }

            verifiedReasoningText = verificationReasoningText;
            verifiedReasoningTokenCount = result.tokens.length;
            syncReasoningTokenCount();

            if (emitSnapshot && onToken) {
              onToken(
                buildGenerationSnapshot(
                  reasoningAccum,
                  responseAccum,
                  reasoningTokenCount,
                  toolCallsAccum,
                ),
              );
            }
          })
          .catch((tokenizeErr) => {
            console.warn(
              "[LLM] failed to verify reasoning token count:",
              tokenizeErr,
            );
            useEstimatedReasoningTokenCount = true;
            syncReasoningTokenCount();
          })
          .finally(() => {
            reasoningTokenVerificationPromise = null;

            if (rerunReasoningTokenVerification) {
              rerunReasoningTokenVerification = false;
              void verifyReasoningTokenCount(options);
            }
          });
      };

      const handleTokenData = (data: LlamaTokenData): LlamaGenerationResult => {
        const tokenText = typeof data.token === "string" ? data.token : "";
        const hadVisibleResponse = responseAccum.trim().length > 0;
        const hasReasoningChunk = typeof data.reasoning_content === "string";
        const hasResponseChunk =
          typeof data.content === "string"
            && stripThinkingTags(data.content).trim().length > 0;

        if (typeof data.accumulated_text === "string") {
          rawAccum = data.accumulated_text;
        } else if (tokenText.length > 0) {
          rawAccum += tokenText;
        }

        const structuredToolCalls = normalizeToolCalls(data.tool_calls);
        const rawTextToolCalls = structuredToolCalls.length === 0
          ? parseToolCallsFromRawText(rawAccum)
          : [];
        toolCallsAccum = mergeToolCalls(
          toolCallsAccum,
          structuredToolCalls.length > 0 ? structuredToolCalls : rawTextToolCalls,
        );

        const parsedRaw = rawAccum.length > 0
          ? parseThinking(rawAccum, {
              implicitThinkOpen: useImplicitThinkOpen,
            })
          : { thinking: null, response: "" };

        const rawHasExplicitThinkTags = !useImplicitThinkOpen && parsedRaw.thinking !== null;

        if ((useImplicitThinkOpen || rawHasExplicitThinkTags) && rawAccum.length > 0) {
          reasoningAccum = parsedRaw.thinking ?? "";
          responseAccum = parsedRaw.response;
        } else if (hasReasoningChunk || typeof data.content === "string") {
          if (hasReasoningChunk) {
            const nextReasoning = data.reasoning_content ?? "";
            reasoningAccum =
              nextReasoning.length >= reasoningAccum.length
                ? nextReasoning
                : reasoningAccum + nextReasoning;
          }
          if (typeof data.content === "string") {
            responseAccum = stripThinkingTags(data.content).trim();
          }
        } else if (rawAccum.length > 0 || tokenText.length > 0) {
          const parsedAccum = parseThinking(rawAccum, {
            implicitThinkOpen: useImplicitThinkOpen,
          });
          reasoningAccum = parsedAccum.thinking ?? "";
          responseAccum = parsedAccum.response;
        }

        if (!hadVisibleResponse && tokenText.length > 0) {
          const boundaryOnlyToken = isThinkBoundaryOnlyToken(tokenText);

          if (hasReasoningChunk) {
            if (!boundaryOnlyToken && !hasResponseChunk) {
              estimatedReasoningTokenCount += 1;
            }
          } else if (useImplicitThinkOpen || rawHasExplicitThinkTags) {
            if (!boundaryOnlyToken && parsedRaw.response.length === 0) {
              estimatedReasoningTokenCount += 1;
            }
          }
        }

        syncReasoningTokenCount();

        if (
          !hadVisibleResponse
          && tokenText.length > 0
          && !useEstimatedReasoningTokenCount
        ) {
          const currentReasoningText = getCurrentNormalizedReasoningText();

          if (
            currentReasoningText.length > 0
            && estimatedReasoningTokenCount
              >= Math.max(1, reasoningTokenLimit - REASONING_TOKEN_VERIFICATION_WINDOW)
            && verifiedReasoningText !== currentReasoningText
          ) {
            void verifyReasoningTokenCount();
          }
        }

        return buildGenerationSnapshot(
          reasoningAccum,
          responseAccum,
          reasoningTokenCount,
          toolCallsAccum,
        );
      };

      try {
        // Lazily initialise multimodal on first vision request
        console.log(
          "[LLM] generateResponse — isMessages:",
          isMessages,
          "| multimodalEnabled:",
          multimodalEnabledRef.current,
          "| mmprojPath:",
          mmprojPathRef.current,
        );

        // Lazy init fallback: eager init failed at load time, retry now
        if (
          isMessages &&
          !multimodalEnabledRef.current &&
          mmprojPathRef.current
        ) {
          const hasImage = (promptOrMessages as StructuredMessages).some(
            (m) =>
              Array.isArray(m.content) &&
              m.content.some((p) => p.type === "image_url"),
          );
          if (hasImage) {
            console.log(
              "[LLM] lazy initMultimodal — path:",
              mmprojPathRef.current,
            );
            const ok = await contextRef.current.initMultimodal({
              path: mmprojPathRef.current,
              use_gpu: false,
            });
            console.log("[LLM] lazy initMultimodal result:", ok);
            if (ok) {
              multimodalEnabledRef.current = true;
              setMultimodalEnabled(true);
            } else {
              throw new Error(
                "initMultimodal returned false — check mmproj file integrity",
              );
            }
          }
        }

        // Hard-fail early if image messages but multimodal still not ready
        if (isMessages) {
          const hasImage = (promptOrMessages as StructuredMessages).some(
            (m) =>
              Array.isArray(m.content) &&
              m.content.some((p) => p.type === "image_url"),
          );
          if (hasImage && !multimodalEnabledRef.current) {
            throw new Error(
              mmprojPathRef.current
                ? "initMultimodal failed — the mmproj file may be corrupted. Try re-downloading the model."
                : "Vision not available: mmproj file not loaded. Reload the model from Settings.",
            );
          }
        }

        if (!isMessages) console.log("[LLM] prompt:", promptOrMessages);

        // Sampling presets from Qwen3 recommended settings (text tasks)
        const samplingParams = thinking
          ? {
              temperature: 1.0,
              top_p: 0.95,
              top_k: 20,
              min_p: 0.0,
              presence_penalty: 1.5,
              repeat_penalty: 1.0,
              // enable_thinking: true,
              // chat_template_kwargs: {
              //   enable_thinking: true,
              // },
            }
          : {
              temperature: 0.7,
              top_p: 0.8,
              top_k: 20,
              min_p: 0.0,
              presence_penalty: 1.5,
              repeat_penalty: 1.0,
            };

        const messageFormattingParams = isMessages
          ? buildMessageFormattingParams(
              promptOrMessages as StructuredMessages,
              {
                thinking,
                alwaysThinks,
                nativeReasoning,
                tools: options?.tools,
                toolChoice: options?.toolChoice,
              },
            )
          : null;
        const needsReasoningFormat = thinking || alwaysThinks;
        const completionInput = isMessages
          ? {
              messages: promptOrMessages as StructuredMessages,
              ...messageFormattingParams,
            }
          : {
              prompt: promptOrMessages as string,
              enable_thinking: needsReasoningFormat,
              reasoning_format: needsReasoningFormat ? ("auto" as const) : ("none" as const),
            };

        if (isMessages && messageFormattingParams) {
          try {
            const formattedChat = await contextRef.current.getFormattedChat(
              promptOrMessages as StructuredMessages,
              null,
              messageFormattingParams,
            );
            console.log(
              "[LLM] formatted prompt:\n" + formattedChat.prompt,
            );

            console.log("[LLM] formatted prompt metadata:", {
              type: formattedChat.type,
              hasMedia: formattedChat.has_media,
              chatFormat: formattedChat.chat_format,
              toolNames: options?.tools?.map((tool) => tool.function.name) ?? [],
              hasGrammar: typeof formattedChat.grammar === "string"
                && formattedChat.grammar.length > 0,
              grammarTriggerCount: formattedChat.grammar_triggers?.length ?? 0,
              additionalStops: formattedChat.additional_stops ?? [],
              preservedTokens: formattedChat.preserved_tokens ?? [],
              thinkingForcedOpen: formattedChat.thinking_forced_open ?? false,
            });
          } catch (formatError) {
            console.warn("[LLM] failed to format prompt for logging:", formatError);
            console.log(
              "[LLM] completion payload fallback:",
              JSON.stringify(completionInput).slice(0, 500),
            );
          }
        } else {
          console.log("[LLM] formatted prompt:\n" + (promptOrMessages as string));
        }

        const result = await contextRef.current.completion(
          {
            ...completionInput,
            // Text-mode thinking gets a bounded output budget instead of the previous runaway cap.
            n_predict: maxGenerationTokens,
            ...samplingParams,
            // jinja: true,
            // enable_thinking: thinking,
            // reasoning_format: "none",
            stop: ["<|im_end|>", "<|endoftext|>", "\n\nHuman:", "\n\nUser:"],
          },
          (data) => {
            // console.log("[LLM] token data:", JSON.stringify(data));
            const snapshot = handleTokenData(data);
            if (onToken) {
              onToken(snapshot);
            }
          },
        );

        const parsedFinalText = parseThinking(result.text ?? rawAccum, {
          implicitThinkOpen: useImplicitThinkOpen,
        });
        const finalHasExplicitThinkTags = !useImplicitThinkOpen && parsedFinalText.thinking !== null;
        const finalResponseCandidate =
          typeof result.content === "string"
            ? stripThinkingTags(result.content).trim()
            : "";
        const finalReasoning =
          useImplicitThinkOpen || finalHasExplicitThinkTags
            ? (parsedFinalText.thinking || reasoningAccum)
            : typeof result.reasoning_content === "string" && result.reasoning_content.trim().length > 0
              ? result.reasoning_content
              : reasoningAccum || parsedFinalText.thinking || "";
        const finalResponse =
          useImplicitThinkOpen || finalHasExplicitThinkTags
            ? (parsedFinalText.response || responseAccum || finalResponseCandidate)
            : finalResponseCandidate || responseAccum || parsedFinalText.response;

        reasoningAccum = finalReasoning;
        responseAccum = finalResponse;
        const finalStructuredToolCalls = normalizeToolCalls(result.tool_calls);
        const finalRawTextToolCalls = finalStructuredToolCalls.length === 0
          ? parseToolCallsFromRawText(result.text ?? rawAccum)
          : [];
        toolCallsAccum = mergeToolCalls(
          toolCallsAccum,
          finalStructuredToolCalls.length > 0 ? finalStructuredToolCalls : finalRawTextToolCalls,
        );
        syncReasoningTokenCount();

        if (reasoningTokenVerificationPromise) {
          await reasoningTokenVerificationPromise;
        }

        if (!useEstimatedReasoningTokenCount) {
          const finalNormalizedReasoningText = getCurrentNormalizedReasoningText();

          if (finalNormalizedReasoningText.length === 0) {
            verifiedReasoningText = "";
            verifiedReasoningTokenCount = 0;
          } else if (verifiedReasoningText !== finalNormalizedReasoningText) {
            try {
              const finalTokenizedReasoning = await contextRef.current.tokenize(
                finalNormalizedReasoningText,
              );
              verifiedReasoningText = finalNormalizedReasoningText;
              verifiedReasoningTokenCount = finalTokenizedReasoning.tokens.length;
            } catch (tokenizeErr) {
              console.warn(
                "[LLM] failed to finalize reasoning token count:",
                tokenizeErr,
              );
              useEstimatedReasoningTokenCount = true;
            }
          }
        }

        syncReasoningTokenCount();
        const finalSnapshot = buildGenerationSnapshot(
          finalReasoning,
          finalResponse,
          reasoningTokenCount,
          toolCallsAccum,
        );

        // console.log("[LLM] completion result:", JSON.stringify(result));
        // console.log("[LLM] final content:", finalSnapshot.combinedContent);

        if (onToken) {
          onToken(finalSnapshot);
        }

        return finalSnapshot;
      } catch (err) {
        if (isStoppedRef.current) {
          isStoppedRef.current = false;
          return buildGenerationSnapshot(
            reasoningAccum,
            responseAccum,
            reasoningTokenCount,
            toolCallsAccum,
          );
        }
        console.error("[LLM] generation error:", err);
        const message = err instanceof Error ? err.message : String(err);
        setError(`Generation failed: ${message}`);
        throw err;
      } finally {
        setIsGenerating(false);
      }
    },
    [],
  );

  const generateTranslation = useCallback(
    async (
      prompt: string,
      onToken?: (data: LlamaStreamUpdate) => void,
      options?: LlamaTranslationGenerationOptions,
    ): Promise<LlamaGenerationResult> => {
      if (!translationContextRef.current) {
        throw new Error("No translation model loaded. Please load a translation model first.");
      }

      setIsTranslationGenerating(true);
      setTranslationError(null);
      translationStoppedRef.current = false;

      let rawAccum = "";
      let responseAccum = "";

      try {
        const result = await translationContextRef.current.completion(
          {
            prompt,
            n_predict: Math.max(256, options?.maxGenerationTokens ?? 1024),
            temperature: 0.1,
            top_p: 0.9,
            top_k: 40,
            min_p: 0.0,
            presence_penalty: 0.0,
            repeat_penalty: 1.05,
            stop: options?.stop ?? ["<end_of_turn>"],
          },
          (data) => {
            const tokenText = typeof data.token === "string" ? data.token : "";

            if (typeof data.accumulated_text === "string") {
              rawAccum = data.accumulated_text;
            } else if (tokenText.length > 0) {
              rawAccum += tokenText;
            }

            const nextResponse = sanitizeTranslationResponse(
              typeof data.content === "string" && data.content.trim().length > 0
                ? data.content
                : rawAccum,
            );

            responseAccum = nextResponse;

            if (onToken) {
              onToken(buildGenerationSnapshot("", nextResponse, 0));
            }
          },
        );

        const finalResponse = sanitizeTranslationResponse(
          typeof result.content === "string" && result.content.trim().length > 0
            ? result.content
            : result.text ?? rawAccum,
        );
        const finalSnapshot = buildGenerationSnapshot("", finalResponse, 0);

        if (onToken) {
          onToken(finalSnapshot);
        }

        return finalSnapshot;
      } catch (err) {
        if (translationStoppedRef.current) {
          translationStoppedRef.current = false;
          return buildGenerationSnapshot("", responseAccum, 0);
        }

        console.error("[LLM] translation generation error:", err);
        const message = err instanceof Error ? err.message : String(err);
        setTranslationError(`Translation failed: ${message}`);
        throw err;
      } finally {
        setIsTranslationGenerating(false);
      }
    },
    [],
  );

  return useMemo(
    () => ({
      isLoading: isLoading || isTranslationLoading,
      isGenerating: isGenerating || isTranslationGenerating,
      loadedModelPath,
      loadedContextSize,
      multimodalEnabled,
      loadedMmprojPath,
      error: error ?? translationError,
      isTranslationLoading,
      isTranslationGenerating,
      loadedTranslationModelPath,
      translationError,
      loadModel,
      unloadModel,
      loadTranslationModel,
      unloadTranslationModel,
      generateResponse,
      generateTranslation,
      countPromptTokens,
      stopGeneration,
      stopTranslationGeneration,
    }),
    [
      isLoading,
      isTranslationLoading,
      isGenerating,
      isTranslationGenerating,
      loadedModelPath,
      loadedContextSize,
      multimodalEnabled,
      loadedMmprojPath,
      error,
      translationError,
      loadedTranslationModelPath,
      loadModel,
      unloadModel,
      loadTranslationModel,
      unloadTranslationModel,
      generateResponse,
      generateTranslation,
      countPromptTokens,
      stopGeneration,
      stopTranslationGeneration,
    ],
  );
}
