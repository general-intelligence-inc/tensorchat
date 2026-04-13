import { Agent } from "./Agent";
import { createWriteMiniAppTool } from "./tools/writeMiniApp";
import { readApp, getAppIdForChat } from "../miniapps/storage";
import { readMemory, formatMemoryForPrompt } from "../miniapps/memory";
import type { MiniApp, MiniAppIdentity } from "../miniapps/types";
import type { UseLlamaReturn } from "../hooks/useLlama";
import {
  renderRetryAppendix,
  renderMultiAttemptAppendix,
  type AttemptRecord,
} from "../miniapps/errorFeedback";
import {
  BASE_SYSTEM_PROMPT,
  PATCH_EXAMPLES,
} from "./miniAppPromptText";

/**
 * Max characters of the current program to inject into the system prompt
 * at compaction level 0. The 16k context leaves room for this plus the
 * base prompt (~2.5k) plus the tool grammar plus the output budget.
 */
const MAX_INJECTED_PROGRAM_CHARS = 3200;
/**
 * How many iterations of the agent loop before giving up. For miniapp
 * mode this is 1 because:
 *   - The tool call IS the output (artifact-first; no text reply needed).
 *   - A second generation race-conditions with llama.rn's context cleanup
 *     after the first one, producing "Context is busy".
 *   - Self-correction (runtime-error retry) creates a fresh Agent for
 *     each attempt via the verifyLoop, so it doesn't need iterations
 *     within a single agent.run.
 */
const MINIAPP_MAX_ITERATIONS = 1;
/**
 * Per-call output token cap for mini-app generation. Gemma E2B at IQ2
 * needs plenty of runway to emit a full tool-call payload in ONE shot:
 *
 *   - A typical tip-calculator / counter app is ~1500-2000 chars of
 *     JavaScript, which tokenizes to ~500-700 tokens.
 *   - The grammar-constrained tool-call wrapper adds ~80-120 tokens
 *     of structured fluff around the `program` field.
 *   - Hitting the token cap mid-program causes the grammar to close
 *     out the JSON with an empty string or a truncated field, which
 *     surfaces as "empty after cleanup" — the exact failure mode we
 *     saw in production logs.
 *
 * 3072 tokens gives enough headroom for a ~2500-char program plus
 * wrapper overhead, which covers essentially every mini-app the 2B
 * model produces without running long.
 */
export const MINIAPP_MAX_GENERATION_TOKENS = 3072;
/** Context window size used when loading the 2B model for Mini Apps mode. */
/**
 * Ideal context size for mini-app generation. 16k fits the full
 * system prompt (~5-6k tokens) + tool grammar overhead + the
 * 3072-token output budget comfortably. On devices with limited RAM,
 * `getMiniAppContextSize` scales this down to avoid OOM kills.
 */
const MINIAPP_CONTEXT_SIZE_IDEAL = 16384;

/**
 * Minimum usable context for mini-app generation. Below this, the
 * system prompt + tool grammar + output budget don't fit — the model
 * would overflow on the first attempt. We refuse to scale lower.
 */
const MINIAPP_CONTEXT_SIZE_MIN = 8192;

/**
 * Rough per-token KV cache cost in bytes. This varies by model
 * architecture and quantization, but 256 bytes/token is a
 * conservative estimate for 2-4B models at Q4 quantization with
 * GQA (grouped-query attention) — Qwen 3.5 and Gemma 4 E2B both
 * use GQA. On 4B models without GQA it'd be higher (~512 bytes);
 * on smaller quants it's lower.
 *
 * We're deliberately conservative here: overestimating the cost
 * means we might use 8k context on a device that could handle 12k,
 * which is fine (everything still works, just less headroom for
 * large programs). Underestimating would cause OOM kills.
 */
const KV_CACHE_BYTES_PER_TOKEN = 256;

/**
 * Pick the best context size for mini-app generation based on
 * available device RAM and model size.
 *
 * Strategy:
 *   1. Start with the ideal (16384)
 *   2. Estimate the model weight RAM + KV cache RAM at that context
 *   3. If the total exceeds 50% of device RAM (the `MODEL_RAM_LIMIT_RATIO`
 *      from modelMemory.ts), step down to 12288, then 8192
 *   4. Never go below MINIAPP_CONTEXT_SIZE_MIN (8192)
 *   5. If device RAM is unknown (simulator, jailbroken, etc.), return
 *      the ideal — better to try and OOM than to preemptively cripple
 *
 * @param modelSizeGB   The model's file size in GB (from ModelConfig.sizeGB).
 *                      Pass 0 or undefined if unknown — defaults to 3 GB
 *                      (a conservative estimate for Qwen 4B Q4 + Gemma E2B).
 * @param deviceRamBytes Total device RAM in bytes (from expo-device).
 *                      Pass null if unknown — returns the ideal.
 */
export function getMiniAppContextSize(
  modelSizeGB?: number,
  deviceRamBytes?: number | null,
): number {
  // If we don't know the device RAM, optimistically use the ideal.
  if (deviceRamBytes == null || deviceRamBytes <= 0) {
    return MINIAPP_CONTEXT_SIZE_IDEAL;
  }

  const modelBytes = (modelSizeGB ?? 3) * 1024 * 1024 * 1024;
  const ramLimit = deviceRamBytes * 0.5; // match MODEL_RAM_LIMIT_RATIO

  // Try each context tier from largest to smallest. Pick the first
  // one where model weights + KV cache fit within the RAM budget.
  const tiers = [16384, 12288, 8192];
  for (const ctx of tiers) {
    const kvCacheBytes = ctx * KV_CACHE_BYTES_PER_TOKEN;
    const totalEstimate = modelBytes + kvCacheBytes;
    if (totalEstimate <= ramLimit) {
      return ctx;
    }
  }

  // Even 8k doesn't fit — return the minimum anyway and let the
  // OS memory pressure system deal with it. The user chose to load
  // this model; we shouldn't silently refuse to work.
  return MINIAPP_CONTEXT_SIZE_MIN;
}

/** Legacy export — callers that don't have model/device info yet. */
export const MINIAPP_CONTEXT_SIZE = MINIAPP_CONTEXT_SIZE_IDEAL;

/**
 * Compaction profile per level. Used by the harness to shrink the system
 * prompt when the estimated token count would exceed the safe budget.
 *
 *   0 — no compaction (default). Full memory, full program injection.
 *   1 — drop all but the 3 most recent memory notes.
 *   2 — level 1 PLUS halve the program injection char budget.
 *   3 — level 2 PLUS drop the program injection entirely; the agent
 *       rebuilds from scratch using just the user request + notes.
 */
export type MiniAppCompactionLevel = 0 | 1 | 2 | 3;

interface CompactionProfile {
  maxMemoryNotes: number | null;
  programInjectionChars: number | null;
}

function compactionProfile(level: MiniAppCompactionLevel): CompactionProfile {
  switch (level) {
    case 0:
      return {
        maxMemoryNotes: null,
        programInjectionChars: MAX_INJECTED_PROGRAM_CHARS,
      };
    case 1:
      return {
        maxMemoryNotes: 3,
        programInjectionChars: MAX_INJECTED_PROGRAM_CHARS,
      };
    case 2:
      return {
        maxMemoryNotes: 3,
        programInjectionChars: Math.floor(MAX_INJECTED_PROGRAM_CHARS / 2),
      };
    case 3:
      return { maxMemoryNotes: 3, programInjectionChars: null };
  }
}

export interface MiniAppAgentOptions {
  llama: UseLlamaReturn;
  chatId: string;
  systemPrompt: string;
  /**
   * Identity (name + emoji) for the new-app creation path. Derived once
   * at the call site via `deriveAppIdentity(firstPrompt)`. Ignored on
   * iteration runs (the existing app's identity is preserved from disk).
   */
  identity: MiniAppIdentity;
  onWritten: (app: MiniApp) => void | Promise<void>;
  onEvent?: (event: import("./types").AgentEvent) => void;
  /** Pass the loaded model's nativeReasoning flag (e.g. true for Gemma 4 E2B). */
  nativeReasoning?: boolean;
}

// BASE_SYSTEM_PROMPT and PATCH_EXAMPLES are imported from
// `./miniAppPromptText.ts` at the top of this file. They used to live
// here inline, but pulling them into a pure module lets the local
// llama-server test harness import the EXACT same prompt text
// production uses, without dragging in react-native-fs.
//
// Section order in BASE_SYSTEM_PROMPT (small models read sequentially):
//   1. Role — one sentence
//   2. Tool picking — write vs patch, decision rule
//   3. tc runtime basics — state, save/load, mount
//   4. Components — all 12 primitives with signatures
//   5. Full counter example
//   6. (dynamic — injected here) Current program with line numbers
//   7. (dynamic — injected here) Memory notes
//   8. (dynamic — injected here) Retry appendix
//   9. Rules — terse closers

/**
 * Truncate a chunk of code to fit within a share of the injection budget.
 * Adds a truncation marker so the LLM can see that it was cut off.
 */
function truncateCodeSection(code: string, maxChars: number): string {
  if (code.length <= maxChars) return code;
  return code.slice(0, maxChars) + "\n/* ...truncated for space... */";
}

/**
 * Render a program with 1-indexed line numbers. Used for the iterate
 * variant so the model can reference specific lines in `patch_mini_app`'s
 * `find` argument. Each line is prefixed with a zero-padded line
 * number + "| " so the program text itself doesn't drift when patched.
 *
 * NOTE: the line numbers are INFORMATIONAL only — the model must still
 * emit the source text verbatim in `find`, not the "12| " prefix. The
 * prefix is for the model's visual grounding.
 */
function renderWithLineNumbers(code: string): string {
  const lines = code.split("\n");
  const width = String(lines.length).length;
  return lines
    .map((line, i) => {
      const num = String(i + 1).padStart(width, " ");
      return num + "| " + line;
    })
    .join("\n");
}

/**
 * Variants of the system prompt. Which variant we pick drives which
 * sections get appended and how the retry appendix is composed.
 */
export type MiniAppPromptVariant =
  | "first-build"       // no app yet
  | "iterate"           // app exists, first attempt this turn
  | "retry-after-error"; // app exists (or doesn't) AND we have a failed attempt

/**
 * Build the system prompt for a miniapp-mode agent run.
 *
 *   - first-build: fresh chat, no existing app, no retry context
 *   - iterate: existing app, first attempt — inject line-numbered program
 *   - retry-after-error: append a retry appendix from the last attempt
 *
 * `previousAttempts` is an array passed through from the harness so
 * attempt 3 can see BOTH attempts 1 and 2 via `renderMultiAttemptAppendix`.
 *
 * Back-compat: a legacy `previousError` string param is still accepted
 * and turned into a synthetic AttemptRecord so existing callers (like
 * the v1 harness path) keep working during the transition.
 */
export async function buildMiniAppSystemPrompt(
  chatId: string,
  options: {
    previousError?: string | null;
    compactionLevel?: MiniAppCompactionLevel;
    /** Explicit variant override. If omitted, we infer it. */
    promptVariant?: MiniAppPromptVariant;
    /** Structured failure records from previous attempts (preferred over previousError). */
    previousAttempts?: AttemptRecord[];
  } = {},
): Promise<{ systemPrompt: string; currentApp: MiniApp | null }> {
  const existingId = await getAppIdForChat(chatId);
  const app = existingId ? await readApp(existingId) : null;
  const level: MiniAppCompactionLevel = options.compactionLevel ?? 0;
  const profile = compactionProfile(level);

  // Infer the variant if not passed explicitly.
  const hasAttempts =
    (options.previousAttempts && options.previousAttempts.length > 0) ||
    !!options.previousError;
  const variant: MiniAppPromptVariant =
    options.promptVariant ??
    (hasAttempts
      ? "retry-after-error"
      : app
        ? "iterate"
        : "first-build");

  // Start with the base prompt. Patch examples only land on the
  // iterate variant AND only when this isn't a retry — retries strip
  // them to free up token budget for the next generation attempt.
  let prompt = BASE_SYSTEM_PROMPT;
  if (variant === "iterate") {
    prompt += PATCH_EXAMPLES;
  }

  // Inject durable agent notes BEFORE the current-program injection so
  // the model reads them first and frames its work around what's already
  // been decided. At higher compaction levels we truncate the notes list.
  try {
    const memory = await readMemory(chatId);
    let effectiveMemory = memory;
    if (
      profile.maxMemoryNotes !== null &&
      memory.notes.length > profile.maxMemoryNotes
    ) {
      effectiveMemory = {
        notes: memory.notes.slice(-profile.maxMemoryNotes),
      };
    }
    const memoryBlock = formatMemoryForPrompt(effectiveMemory);
    if (memoryBlock) {
      prompt += memoryBlock;
    }
  } catch (err) {
    console.warn("[TensorChat] readMemory failed:", err);
  }

  // Inject the current program for iterate and retry variants (as long
  // as the compaction profile allows it). The retry variant uses the
  // SAME line-numbered format so the model can still point its patch
  // `find` at specific lines after a failure.
  const shouldInjectProgram =
    app !== null &&
    (variant === "iterate" || variant === "retry-after-error") &&
    profile.programInjectionChars !== null;

  if (shouldInjectProgram && app && profile.programInjectionChars !== null) {
    const slice = truncateCodeSection(app.program, profile.programInjectionChars);
    const numbered = renderWithLineNumbers(slice);
    prompt +=
      `\n\n## Current program\n\n` +
      `Name: ${app.name}   Emoji: ${app.emoji}   Version: ${app.version} ` +
      `(you will produce v${app.version + 1})\n\n` +
      `Lines are numbered for reference. When calling patch_mini_app, ` +
      `copy the source text VERBATIM into \`find\` — do NOT include the ` +
      `"N| " line-number prefix.\n\n` +
      "```javascript\n" +
      numbered +
      "\n```";
  } else if (app && profile.programInjectionChars === null) {
    // Level-3 compaction: the current program is too big to inject.
    prompt +=
      `\n\n## Current program\n\n` +
      `This chat has an existing app ("${app.name}" ${app.emoji} v${app.version}) ` +
      `but its source is too large to show. Use write_mini_app to rewrite ` +
      `it minimally, keeping the same general purpose. You will produce ` +
      `v${app.version + 1}.`;
  }

  // Retry appendix — either from structured AttemptRecords (preferred)
  // or from the legacy previousError string.
  const attempts = options.previousAttempts;
  if (attempts && attempts.length > 0) {
    const appendix =
      attempts.length >= 2
        ? renderMultiAttemptAppendix(attempts)
        : renderRetryAppendix(attempts[attempts.length - 1]);
    prompt += appendix;
  } else if (options.previousError) {
    // Legacy path: wrap the string error as a synthetic AttemptRecord.
    const synthetic: AttemptRecord = {
      attempt: 1,
      toolUsed: null,
      programFingerprint: null,
      errorMessage: options.previousError,
    };
    prompt += renderRetryAppendix(synthetic);
  }

  return { systemPrompt: prompt, currentApp: app };
}

/**
 * Build a mini-app Agent for a specific chat. Each send in miniapp mode
 * constructs a fresh Agent instance (the factory is cheap, no state is
 * retained across user turns — the "memory" of what was built is on disk
 * and gets re-injected via `buildMiniAppSystemPrompt`).
 */
export function createMiniAppAgent(opts: MiniAppAgentOptions): Agent {
  const tool = createWriteMiniAppTool({
    chatId: opts.chatId,
    identity: opts.identity,
    onWritten: opts.onWritten,
  });

  return new Agent(opts.llama, {
    systemPrompt: opts.systemPrompt,
    tools: [tool],
    maxIterations: MINIAPP_MAX_ITERATIONS,
    thinking: false,
    alwaysThinks: false,
    nativeReasoning: opts.nativeReasoning ?? false,
    maxGenerationTokens: MINIAPP_MAX_GENERATION_TOKENS,
    // No trailing text confirmation — the written app IS the reply, and
    // a second generation would race the llama context.
    skipFinalForceText: true,
    onEvent: opts.onEvent,
  });
}
