/**
 * Mini-app creator agent harness.
 *
 * Sits ABOVE the existing `Agent` class and wraps its execution with:
 *   1. Bounded retries (per-attempt timeout + total-budget deadline + cooldowns)
 *   2. Cancellation tokens that unwind a stuck llama call
 *   3. Step-level tracing of every phase for post-mortem debugging
 *   4. Context-size estimation + 3-level compaction before each attempt
 *   5. Error classification that drives per-class recovery strategies
 *
 * The harness is the ONLY place `runMiniAppGeneration` calls — everything
 * about retry logic, timeout handling, and context management lives here.
 * ChatScreen becomes a thin consumer that creates a CancelToken, calls
 * `runMiniAppHarness(...)`, and translates status events into its UI state.
 *
 * Why this module exists: the previous inline retry loop in ChatScreen
 * had no timeout on `agent.run()`, so any llama hang wedged the whole
 * feature indefinitely (the `miniAppGenBusyRef` mutex could never be
 * released, deadlocking even the reset effect). The harness's
 * `raceWithTimeout` primitive makes "stuck on retry" structurally
 * impossible — the timer will ALWAYS win against a hung completion.
 */

import { Agent } from "../agent/Agent";
import { createWriteMiniAppTool } from "../agent/tools/writeMiniApp";
import { createPatchMiniAppTool } from "../agent/tools/patchMiniApp";
import type { AttemptRecord } from "./errorFeedback";
import {
  classifyLlamaError,
  humanizeRetryReason,
} from "./llamaErrorCatalog";
import {
  buildMiniAppSystemPrompt,
  MINIAPP_MAX_GENERATION_TOKENS,
} from "../agent/miniAppAgent";
import type { UseLlamaReturn } from "../hooks/useLlama";
import type { AgentEvent } from "../agent/types";
import type { MiniApp, MiniAppIdentity } from "./types";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface HarnessOptions {
  chatId: string;
  userText: string;
  llama: UseLlamaReturn;
  cancelToken: CancelToken;
  onStatusChange: (status: HarnessStatus) => void;
  onTrace?: (event: TraceEvent) => void;
  onWritten: (app: MiniApp) => void;
  retryAttempt?: number;
  /**
   * Identity (name + emoji) used only when this chat doesn't yet have an
   * app on disk. Derived once at the call site by `deriveAppIdentity`
   * from the user's first prompt. The harness threads it down to the
   * write_mini_app tool's context; the tool ignores it on iteration runs.
   */
  identity: MiniAppIdentity;
  // Tunables (all have sensible defaults below).
  maxAttempts?: number;
  perAttemptTimeoutMs?: number;
  totalBudgetMs?: number;
  cooldownMs?: number;
  contextBusyCooldownMs?: number;
  promptTokenBudget?: number;
  /** Pass the loaded model's nativeReasoning flag so the Agent uses
   *  the correct chat template kwargs for Gemma 4 E2B. */
  nativeReasoning?: boolean;
  /** Route tool definitions via system prompt instead of GBNF grammar. */
  systemPromptTools?: boolean;
  /** Model always emits <think> tags regardless of settings. */
  alwaysThinks?: boolean;
}

/**
 * Human-readable sub-phase for the generating status — surfaced in the
 * UI as the text under the spinner so the user sees progress rather
 * than a single opaque "Building app…" for the entire llama call.
 *
 * The harness moves through these in order during a successful attempt:
 *   preparing → thinking → drafting → tool-call → writing → verifying
 *
 * Not every phase is always visited:
 *   - `thinking` is skipped when the model replies without a <think> block
 *   - `drafting` is skipped when the model goes straight to a tool call
 *   - `tool-call` is what we report as soon as we see the tool-call event;
 *     `writing` kicks in once the tool's execute() runs and the file is
 *     written to disk
 *   - `verifying` is the brief window after the write lands, before the
 *     harness returns success
 */
export type GeneratingPhase =
  | "preparing"
  | "thinking"
  | "drafting"
  | "tool-call"
  | "writing"
  | "verifying";

export type HarnessStatus =
  | { kind: "idle" }
  | { kind: "planning"; label?: string }
  | {
      kind: "generating";
      attempt: number;
      maxAttempts: number;
      phase: GeneratingPhase;
      label: string;
    }
  | { kind: "writing"; label?: string }
  | {
      kind: "retrying";
      attempt: number;
      maxAttempts: number;
      reason: string;
    }
  | { kind: "cancelled" }
  | { kind: "error"; message: string; errorClass: ErrorClass };

/** Default human-readable label per generating phase. */
export function labelForGeneratingPhase(phase: GeneratingPhase): string {
  switch (phase) {
    case "preparing":
      return "Preparing…";
    case "thinking":
      return "Thinking…";
    case "drafting":
      return "Drafting response…";
    case "tool-call":
      return "Designing the app…";
    case "writing":
      return "Writing program…";
    case "verifying":
      return "Verifying…";
  }
}

// ErrorClass, classifyError, and the Harness*Error classes were
// extracted into `./classifyError.ts` so they're testable in Node
// without pulling in Agent → llamaAdapter → llama.rn. Re-exported
// here for backwards compatibility with callers that still import
// them from this module.
export {
  classifyError,
  HarnessTimeoutError,
  HarnessCancelledError,
  type ErrorClass,
} from "./classifyError";
import {
  classifyError,
  HarnessTimeoutError,
  HarnessCancelledError,
  type ErrorClass,
} from "./classifyError";

export type TraceEvent =
  | { t: "start"; at: number; chatId: string }
  | {
      t: "promptBuilt";
      at: number;
      chars: number;
      estTokens: number;
      compacted: boolean;
      compactionLevel: CompactionLevel;
    }
  | { t: "llamaStart"; at: number; attempt: number }
  | { t: "toolCall"; at: number; name: string; argsChars: number }
  | {
      t: "toolResult";
      at: number;
      isError: boolean;
      contentChars: number;
    }
  | {
      t: "llamaEnd";
      at: number;
      attempt: number;
      durationMs: number;
    }
  | {
      t: "retry";
      at: number;
      attempt: number;
      reason: string;
      errorClass: ErrorClass;
      cooldownMs: number;
    }
  | { t: "timeout"; at: number; attempt: number; afterMs: number }
  | { t: "cancelled"; at: number }
  | {
      t: "compact";
      at: number;
      fromChars: number;
      toChars: number;
      level: CompactionLevel;
      dropped: string[];
    }
  | {
      t: "done";
      at: number;
      success: boolean;
      totalDurationMs: number;
      attempts: number;
    };

export type CompactionLevel = 0 | 1 | 2 | 3;

export interface HarnessResult {
  kind: "success" | "error" | "cancelled";
  app?: MiniApp;
  errorClass?: ErrorClass;
  errorMessage?: string;
  /** Count of attempts consumed. */
  attempts: number;
  totalDurationMs: number;
  trace: TraceEvent[];
  /**
   * Structured records for every attempt this run made, success or
   * failure. Used by the dev trace panel's Attempts tab and by any
   * future consumer that wants to look at the failure sequence without
   * parsing the raw trace event stream.
   */
  attemptRecords: AttemptRecord[];
}

export interface CancelToken {
  cancel: () => void;
  isCancelled: () => boolean;
  /**
   * Promise that resolves (never rejects) when the token is cancelled.
   * Used inside Promise.race to preempt in-flight work.
   */
  whenCancelled: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_MAX_ATTEMPTS = 3;
// 180s per attempt — first-attempt on a cold llama.rn KV cache can
// spend 10-20s just on prompt eval for an 1800-token system prompt,
// plus 30-90s generating ~1500 chars of tool-call output at IQ2
// quantization. The previous 90s budget was catching legitimate work
// as "timeout". Retries reuse the same budget; the total budget below
// caps the whole harness run so we still bail out if everything hangs.
const DEFAULT_PER_ATTEMPT_TIMEOUT_MS = 180_000;
// 480s total — three 180s attempts fit comfortably with cooldowns.
const DEFAULT_TOTAL_BUDGET_MS = 480_000;
const DEFAULT_COOLDOWN_MS = 750;
const DEFAULT_CONTEXT_BUSY_COOLDOWN_MS = 3_000;

/**
 * Fast string fingerprint — djb2-xor variant. Not cryptographically
 * sound but good enough to detect when the model re-submits byte-for-
 * byte identical programs across retries, which is the only thing the
 * harness uses this for. Runs in O(n) over the program chars and
 * returns a short hex string for logging.
 */
function fingerprintProgram(program: string): string {
  let h = 5381;
  for (let i = 0; i < program.length; i++) {
    h = ((h << 5) + h) ^ program.charCodeAt(i);
    // Force 32-bit semantics.
    h |= 0;
  }
  return (h >>> 0).toString(16);
}
/**
 * Soft cap on prompt tokens for a miniapp run. Leaves ~4k headroom in a
 * 16k context for the per-call output budget (2048) plus streaming +
 * grammar overhead.
 */
const DEFAULT_PROMPT_TOKEN_BUDGET = 12_000;

// ---------------------------------------------------------------------------
// Sentinel error classes — used internally to discriminate Promise.race winners
// ---------------------------------------------------------------------------

// (HarnessTimeoutError, HarnessCancelledError extracted to ./classifyError.ts
// and re-exported at the top of this file.)

// ---------------------------------------------------------------------------
// CancelToken
// ---------------------------------------------------------------------------

export function createCancelToken(): CancelToken {
  let cancelled = false;
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  let resolveWaiter: () => void = () => {};
  const waiter = new Promise<void>((resolve) => {
    resolveWaiter = resolve;
  });
  return {
    cancel(): void {
      if (cancelled) return;
      cancelled = true;
      resolveWaiter();
    },
    isCancelled(): boolean {
      return cancelled;
    },
    whenCancelled(): Promise<void> {
      return waiter;
    },
  };
}

// ---------------------------------------------------------------------------
// raceWithTimeout — the primitive that makes hangs non-fatal
// ---------------------------------------------------------------------------

type RaceOutcome<T> =
  | { kind: "ok"; value: T }
  | { kind: "timeout"; afterMs: number }
  | { kind: "cancelled" };

/**
 * Runs `promise` with a timeout and a cancel-token race. Exactly one of
 * three outcomes wins; the other two continue running but their results
 * are dropped on the floor. Callers MUST handle "timeout" and "cancelled"
 * explicitly — they are not thrown.
 *
 * On timeout/cancel, the caller is responsible for any cleanup needed on
 * the underlying work (e.g. calling `llama.stopGeneration()` to nudge
 * llama.rn to abort the native completion).
 */
export async function raceWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  cancelToken: CancelToken,
): Promise<RaceOutcome<T>> {
  let timerHandle: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timerHandle = setTimeout(() => {
      reject(new HarnessTimeoutError(timeoutMs));
    }, timeoutMs);
  });
  const cancelPromise = cancelToken.whenCancelled().then(() => {
    throw new HarnessCancelledError();
  });

  try {
    const value = await Promise.race([promise, timeoutPromise, cancelPromise]);
    return { kind: "ok", value };
  } catch (err) {
    if (err instanceof HarnessTimeoutError) {
      return { kind: "timeout", afterMs: err.afterMs };
    }
    if (err instanceof HarnessCancelledError) {
      return { kind: "cancelled" };
    }
    // Real error from the work promise — rethrow so callers can classify.
    throw err;
  } finally {
    if (timerHandle !== null) {
      clearTimeout(timerHandle);
    }
  }
}

/**
 * Await a simple sleep that can be preempted by cancellation.
 * Used for inter-attempt cooldowns.
 */
async function racedSleep(
  ms: number,
  cancelToken: CancelToken,
): Promise<void> {
  if (ms <= 0) return;
  let timerHandle: ReturnType<typeof setTimeout> | null = null;
  const sleepPromise = new Promise<void>((resolve) => {
    timerHandle = setTimeout(resolve, ms);
  });
  try {
    await Promise.race([sleepPromise, cancelToken.whenCancelled()]);
  } finally {
    if (timerHandle !== null) {
      clearTimeout(timerHandle);
    }
  }
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

// (classifyError extracted to ./classifyError.ts and re-exported at
// the top of this file.)

// ---------------------------------------------------------------------------
// Main entry point (stub — real body comes in Step 4)
// ---------------------------------------------------------------------------

/**
 * Run the mini-app creator agent harness. See the design doc in
 * `.claude/plans/vast-questing-cupcake.md` ("Harness Redesign (v2)")
 * for the full flow diagram.
 */
export async function runMiniAppHarness(
  opts: HarnessOptions,
): Promise<HarnessResult> {
  const {
    chatId,
    userText,
    llama,
    cancelToken,
    onStatusChange,
    onTrace,
    onWritten,
    retryAttempt = 0,
    identity,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    perAttemptTimeoutMs = DEFAULT_PER_ATTEMPT_TIMEOUT_MS,
    totalBudgetMs = DEFAULT_TOTAL_BUDGET_MS,
    cooldownMs = DEFAULT_COOLDOWN_MS,
    contextBusyCooldownMs = DEFAULT_CONTEXT_BUSY_COOLDOWN_MS,
    promptTokenBudget = DEFAULT_PROMPT_TOKEN_BUDGET,
    nativeReasoning = false,
    systemPromptTools = false,
    alwaysThinks = false,
  } = opts;

  const startedAt = Date.now();
  const trace: TraceEvent[] = [];
  const emit = (event: TraceEvent): void => {
    trace.push(event);
    try {
      onTrace?.(event);
    } catch {
      // Trace callbacks must never break the harness.
    }
  };

  emit({ t: "start", at: startedAt, chatId });

  let lastErrorMessage: string | null = null;
  let lastErrorClass: ErrorClass = "unknown";
  let compactionLevel: CompactionLevel = 0;
  let attemptsRun = 0;

  // Structured history of every attempt within this harness run.
  // Used by:
  //   - the retry prompt composer (renderRetryAppendix/renderMultiAttemptAppendix)
  //   - fingerprint deduplication (skip identical programs without burning a llama call)
  //   - the HarnessResult carried back to the caller for the dev trace panel
  const attemptRecords: AttemptRecord[] = [];
  const fingerprintsSeen = new Set<string>();

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    attemptsRun = attempt;

    if (cancelToken.isCancelled()) {
      emit({ t: "cancelled", at: Date.now() });
      const totalDurationMs = Date.now() - startedAt;
      emit({
        t: "done",
        at: Date.now(),
        success: false,
        totalDurationMs,
        attempts: attemptsRun,
      });
      onStatusChange({ kind: "cancelled" });
      return {
        kind: "cancelled",
        attempts: attemptsRun,
        totalDurationMs,
        trace,
        attemptRecords,
      };
    }

    const elapsedSoFar = Date.now() - startedAt;
    if (elapsedSoFar > totalBudgetMs) {
      const message = `Total budget of ${totalBudgetMs}ms exceeded after ${attempt - 1} attempts`;
      const totalDurationMs = Date.now() - startedAt;
      emit({
        t: "done",
        at: Date.now(),
        success: false,
        totalDurationMs,
        attempts: attemptsRun - 1,
      });
      onStatusChange({
        kind: "error",
        message,
        errorClass: "timeout",
      });
      return {
        kind: "error",
        errorClass: "timeout",
        errorMessage: message,
        attempts: attemptsRun - 1,
        totalDurationMs,
        trace,
        attemptRecords,
      };
    }

    // [PLAN PHASE] Build the prompt and size-check it.
    onStatusChange({ kind: "planning", label: "Planning…" });
    const planResult = await planAttempt({
      chatId,
      llama,
      previousError: lastErrorMessage,
      previousErrorClass: lastErrorClass,
      previousAttempts: attemptRecords,
      startingCompactionLevel: compactionLevel,
      promptTokenBudget,
      cancelToken,
      emit,
    });

    if (planResult.kind === "cancelled") {
      emit({ t: "cancelled", at: Date.now() });
      const totalDurationMs = Date.now() - startedAt;
      emit({
        t: "done",
        at: Date.now(),
        success: false,
        totalDurationMs,
        attempts: attemptsRun,
      });
      onStatusChange({ kind: "cancelled" });
      return {
        kind: "cancelled",
        attempts: attemptsRun,
        totalDurationMs,
        trace,
        attemptRecords,
      };
    }

    if (planResult.kind === "overflow") {
      // Could not shrink enough — bail with context-overflow.
      const totalDurationMs = Date.now() - startedAt;
      emit({
        t: "done",
        at: Date.now(),
        success: false,
        totalDurationMs,
        attempts: attemptsRun,
      });
      onStatusChange({
        kind: "error",
        message: planResult.message,
        errorClass: "context-overflow",
      });
      return {
        kind: "error",
        errorClass: "context-overflow",
        errorMessage: planResult.message,
        attempts: attemptsRun,
        totalDurationMs,
        trace,
        attemptRecords,
      };
    }

    const { systemPrompt } = planResult;
    compactionLevel = planResult.compactionLevel;

    // [GENERATE PHASE] Kick off as "preparing" — runSingleAttempt will
    // push finer-grained phase updates (thinking → drafting → tool-call
    // → writing → verifying) as the Agent events stream in.
    onStatusChange({
      kind: "generating",
      attempt,
      maxAttempts,
      phase: "preparing",
      label: labelForGeneratingPhase("preparing"),
    });

    // Escalation: if the two most recent attempts BOTH called
    // patch_mini_app and BOTH failed, drop patch_mini_app from the
    // tool list for this attempt. Gemma (and other 2B models)
    // cheerfully ignore "switch to write_mini_app" hints in the
    // retry prompt and keep trying patches — stripping the tool
    // from the grammar is the only reliable escalation.
    const lastTwo = attemptRecords.slice(-2);
    const bothPatchFailures =
      lastTwo.length === 2 &&
      lastTwo.every(
        (r) => r.toolUsed === "patch_mini_app" && r.errorKind !== undefined,
      );

    const attemptResult = await runSingleAttempt({
      attempt,
      maxAttempts,
      systemPrompt,
      userText,
      chatId,
      identity,
      llama,
      cancelToken,
      perAttemptTimeoutMs,
      emit,
      onStatusChange,
      dropPatchTool: bothPatchFailures,
      nativeReasoning,
      systemPromptTools,
      alwaysThinks,
    });

    if (attemptResult.kind === "cancelled") {
      try {
        await llama.stopGeneration();
      } catch {}
      emit({ t: "cancelled", at: Date.now() });
      const totalDurationMs = Date.now() - startedAt;
      emit({
        t: "done",
        at: Date.now(),
        success: false,
        totalDurationMs,
        attempts: attemptsRun,
      });
      onStatusChange({ kind: "cancelled" });
      return {
        kind: "cancelled",
        attempts: attemptsRun,
        totalDurationMs,
        trace,
        attemptRecords,
      };
    }

    if (attemptResult.kind === "success") {
      // Stamp a successful AttemptRecord into the history. Useful for
      // the dev trace panel's post-mortem view and for any caller
      // that wants to know which attempt finally succeeded.
      const successFingerprint = fingerprintProgram(attemptResult.app.program);
      fingerprintsSeen.add(successFingerprint);
      attemptRecords.push({
        attempt,
        toolUsed:
          (attemptResult.toolUsed ?? null) as AttemptRecord["toolUsed"],
        programFingerprint: successFingerprint,
      });

      // Run onWritten callback BEFORE marking done so consumers can
      // refresh their state.
      try {
        onWritten(attemptResult.app);
      } catch (err) {
        console.warn("[Harness] onWritten callback threw:", err);
      }
      const totalDurationMs = Date.now() - startedAt;
      emit({
        t: "done",
        at: Date.now(),
        success: true,
        totalDurationMs,
        attempts: attemptsRun,
      });
      onStatusChange({ kind: "idle" });
      return {
        kind: "success",
        app: attemptResult.app,
        attempts: attemptsRun,
        totalDurationMs,
        trace,
        attemptRecords,
      };
    }

    // attemptResult.kind === "failure"
    const errorClass = classifyError(
      attemptResult.thrownError,
      attemptResult.toolResultError,
    );
    lastErrorMessage = attemptResult.reason;
    lastErrorClass = errorClass;

    // Record the failed attempt so the next plan phase can build a
    // specific retry appendix via renderRetryAppendix. The errorKind
    // here is the legacy ErrorClass string — errorFeedback's per-code
    // templates don't match on it, so it falls through to the generic
    // "PREVIOUS ATTEMPT FAILED" template with the reason text. Step 11
    // replaces this with a structured ValidationIssue once we have a
    // real ValidationCode channel.
    attemptRecords.push({
      attempt,
      toolUsed:
        (attemptResult.toolUsed ?? null) as AttemptRecord["toolUsed"],
      programFingerprint: null,
      errorKind: errorClass,
      errorMessage: attemptResult.reason,
    });

    // Decide next-attempt strategy based on error class.
    if (errorClass === "hard-failure") {
      const totalDurationMs = Date.now() - startedAt;
      emit({
        t: "done",
        at: Date.now(),
        success: false,
        totalDurationMs,
        attempts: attemptsRun,
      });
      onStatusChange({
        kind: "error",
        message: attemptResult.reason,
        errorClass,
      });
      return {
        kind: "error",
        errorClass,
        errorMessage: attemptResult.reason,
        attempts: attemptsRun,
        totalDurationMs,
        trace,
        attemptRecords,
      };
    }

    if (attempt === maxAttempts) {
      // Exhausted retries.
      const totalDurationMs = Date.now() - startedAt;
      emit({
        t: "done",
        at: Date.now(),
        success: false,
        totalDurationMs,
        attempts: attemptsRun,
      });
      onStatusChange({
        kind: "error",
        message: attemptResult.reason,
        errorClass,
      });
      return {
        kind: "error",
        errorClass,
        errorMessage: attemptResult.reason,
        attempts: attemptsRun,
        totalDurationMs,
        trace,
        attemptRecords,
      };
    }

    // Bump compaction level proactively for any error where a shorter
    // prompt is likely to help:
    //
    //   - timeout: the model ran out of time; shorter prompt = faster
    //     prompt-eval + more headroom for generation
    //   - context-overflow: obvious, the prompt was too big
    //   - tool-validation: the model emitted empty-program or malformed
    //     output, often because it ran out of output token budget
    //     mid-generation; cutting the prompt frees up more of the
    //     n_predict budget for actual program content
    if (
      errorClass === "timeout" ||
      errorClass === "context-overflow" ||
      errorClass === "tool-validation"
    ) {
      compactionLevel = clampCompactionLevel(compactionLevel + 1);
    }

    const cooldownForThisClass =
      errorClass === "context-busy" ? contextBusyCooldownMs : cooldownMs;

    // Humanized retry reason — "Fixing a runtime bug…" etc. — instead
    // of the raw internal error class. Surfaces in the status strip
    // and the dev trace panel. Falls back to "Retrying…" for kinds
    // the catalog doesn't recognize.
    const humanReason = humanizeRetryReason(errorClass);

    emit({
      t: "retry",
      at: Date.now(),
      attempt: attempt + 1,
      reason: humanReason,
      errorClass,
      cooldownMs: cooldownForThisClass,
    });
    onStatusChange({
      kind: "retrying",
      attempt: attempt + 1,
      maxAttempts,
      reason: humanReason,
    });

    // Try to nudge llama.rn to fully release any residual context state
    // from the failing completion before we start the next one.
    try {
      await llama.stopGeneration();
    } catch {}

    await racedSleep(cooldownForThisClass, cancelToken);
  }

  // Fallback — should not reach here since the loop returns on the last
  // attempt, but TypeScript wants a return path.
  const totalDurationMs = Date.now() - startedAt;
  emit({
    t: "done",
    at: Date.now(),
    success: false,
    totalDurationMs,
    attempts: attemptsRun,
  });
  const fallbackMessage = lastErrorMessage ?? "Unknown harness failure";
  onStatusChange({
    kind: "error",
    message: fallbackMessage,
    errorClass: lastErrorClass,
  });
  return {
    kind: "error",
    errorClass: lastErrorClass,
    errorMessage: fallbackMessage,
    attempts: attemptsRun,
    totalDurationMs,
    trace,
    attemptRecords,
  };
}

// ---------------------------------------------------------------------------
// Planning phase (builds the system prompt and size-checks it)
// ---------------------------------------------------------------------------

type PlanOutcome =
  | {
      kind: "ok";
      systemPrompt: string;
      compactionLevel: CompactionLevel;
    }
  | { kind: "cancelled" }
  | { kind: "overflow"; message: string };

async function planAttempt(params: {
  chatId: string;
  llama: UseLlamaReturn;
  previousError: string | null;
  previousErrorClass: ErrorClass;
  /**
   * Structured records from prior attempts in this run. Passed through
   * to `buildMiniAppSystemPrompt` which uses them to produce a rich
   * retry appendix via `renderRetryAppendix` / `renderMultiAttemptAppendix`.
   * Empty on the first attempt.
   */
  previousAttempts: AttemptRecord[];
  startingCompactionLevel: CompactionLevel;
  promptTokenBudget: number;
  cancelToken: CancelToken;
  emit: (e: TraceEvent) => void;
}): Promise<PlanOutcome> {
  const {
    chatId,
    llama,
    previousError,
    previousAttempts,
    startingCompactionLevel,
    promptTokenBudget,
    cancelToken,
    emit,
  } = params;

  let compactionLevel = startingCompactionLevel;

  // Try up to 4 compaction levels (0 = none, 3 = drop injection entirely).
  for (let i = 0; i < 4; i++) {
    if (cancelToken.isCancelled()) return { kind: "cancelled" };

    const { systemPrompt } = await buildMiniAppSystemPrompt(chatId, {
      // Legacy string error — kept as a fallback if we don't yet have
      // structured AttemptRecords (e.g. first retry from a legacy path).
      previousError,
      // Structured attempt records — the preferred retry-context source.
      // When non-empty, buildMiniAppSystemPrompt uses these to pick
      // retry-after-error variant and compose a rich appendix.
      previousAttempts,
      compactionLevel,
    });

    // Rough token estimate via llama.countPromptTokens. Fall back to a
    // char/4 heuristic if the real count errors out.
    let estTokens: number;
    try {
      const counted = await llama.countPromptTokens(systemPrompt);
      estTokens =
        typeof counted === "number" && counted > 0
          ? counted
          : Math.ceil(systemPrompt.length / 4);
    } catch {
      estTokens = Math.ceil(systemPrompt.length / 4);
    }

    emit({
      t: "promptBuilt",
      at: Date.now(),
      chars: systemPrompt.length,
      estTokens,
      compacted: compactionLevel > 0,
      compactionLevel,
    });

    if (estTokens <= promptTokenBudget) {
      return { kind: "ok", systemPrompt, compactionLevel };
    }

    // Over budget — bump compaction level and try again.
    if (compactionLevel >= 3) {
      return {
        kind: "overflow",
        message: `Prompt still ${estTokens} tokens after level-3 compaction (budget ${promptTokenBudget}).`,
      };
    }
    compactionLevel = clampCompactionLevel(compactionLevel + 1);
    emit({
      t: "compact",
      at: Date.now(),
      fromChars: systemPrompt.length,
      toChars: 0, // filled when we re-estimate
      level: compactionLevel,
      dropped: describeCompactionDropped(compactionLevel),
    });
  }

  return {
    kind: "overflow",
    message: "Prompt exceeded budget at maximum compaction level.",
  };
}

function clampCompactionLevel(level: number): CompactionLevel {
  if (level <= 0) return 0;
  if (level >= 3) return 3;
  return level as CompactionLevel;
}

function describeCompactionDropped(level: CompactionLevel): string[] {
  switch (level) {
    case 0:
      return [];
    case 1:
      return ["old memory notes (keep 3 most recent)"];
    case 2:
      return ["old memory notes", "half the current-app injection"];
    case 3:
      return [
        "old memory notes",
        "current-app injection (agent rebuilds from scratch)",
      ];
  }
}

// ---------------------------------------------------------------------------
// Single attempt — one Agent instance, one llama completion, bounded by time
// ---------------------------------------------------------------------------

type AttemptOutcome =
  | { kind: "success"; app: MiniApp; toolUsed: string | null }
  | { kind: "cancelled" }
  | {
      kind: "failure";
      reason: string;
      thrownError: unknown | null;
      toolResultError: string | null;
      /**
       * Name of the tool the model called, if any. Used by the
       * main loop's escalation logic — 2+ consecutive patch_mini_app
       * failures cause the next attempt to drop the patch tool from
       * the tool list so the grammar forces a write_mini_app.
       */
      toolUsed: string | null;
    };

async function runSingleAttempt(params: {
  identity: MiniAppIdentity;
  attempt: number;
  maxAttempts: number;
  systemPrompt: string;
  userText: string;
  chatId: string;
  llama: UseLlamaReturn;
  cancelToken: CancelToken;
  perAttemptTimeoutMs: number;
  emit: (e: TraceEvent) => void;
  onStatusChange: (status: HarnessStatus) => void;
  /**
   * When true, only expose write_mini_app to the agent. Used on
   * retries after 2+ consecutive patch_mini_app failures — small
   * models will cheerfully ignore a "switch to write_mini_app" hint
   * and keep calling patch, so the only reliable escalation is to
   * remove the patch tool from the available tool set entirely.
   */
  dropPatchTool?: boolean;
  /** Model's nativeReasoning flag — forwarded to the Agent so
   *  buildMessageFormattingParams uses the correct kwargs. */
  nativeReasoning?: boolean;
  /** Route tool definitions via system prompt instead of GBNF grammar. */
  systemPromptTools?: boolean;
  /** Model always emits <think> tags regardless of settings. */
  alwaysThinks?: boolean;
}): Promise<AttemptOutcome> {
  const {
    attempt,
    maxAttempts,
    systemPrompt,
    userText,
    chatId,
    identity,
    llama,
    cancelToken,
    perAttemptTimeoutMs,
    emit,
    onStatusChange,
    dropPatchTool = false,
    nativeReasoning = false,
    systemPromptTools = false,
    alwaysThinks = false,
  } = params;

  let writtenApp: MiniApp | null = null;
  let toolResultError: string | null = null;
  let agentError: unknown | null = null;
  // Captured from the first toolCall AgentEvent so the main loop's
  // escalation logic can see which tool the model called on a
  // failed attempt.
  let toolUsedName: string | null = null;

  // Track the current phase so we only emit status updates when it
  // actually changes — prevents fire-hose re-renders from per-token
  // thinking/text streams.
  let currentPhase: GeneratingPhase = "preparing";
  // Phase-strength monotonic ordering. The time-based heartbeat
  // below can only ADVANCE the phase, never regress it — so if the
  // first real event says "tool-call" and then a stray late token
  // arrives, the label doesn't jump backwards.
  const phaseOrder: Record<GeneratingPhase, number> = {
    preparing: 0,
    thinking: 1,
    drafting: 2,
    "tool-call": 3,
    writing: 4,
    verifying: 5,
  };
  // Shared elapsed-time getter so both pushPhase and the heartbeat
  // tick emit the SAME "(Ns)" suffix. The elapsed counter is the
  // difference between start-of-attempt and now — it includes every
  // phase, not just the current one.
  const heartbeatStartedAt = Date.now();
  const elapsedSec = (): number =>
    Math.floor((Date.now() - heartbeatStartedAt) / 1000);

  /**
   * Render the label for a phase with the elapsed-time suffix.
   * On-device 2B model generations can take 30-90s per attempt, and
   * grammar-constrained output streams almost no events — without a
   * visible ticker the UI looks frozen during legitimate work.
   */
  const labelWithElapsed = (phase: GeneratingPhase, custom?: string): string => {
    const base = custom ?? labelForGeneratingPhase(phase);
    const sec = elapsedSec();
    return sec > 0 ? `${base} (${sec}s)` : base;
  };

  const pushPhase = (phase: GeneratingPhase, label?: string): void => {
    if (phaseOrder[phase] <= phaseOrder[currentPhase]) return;
    currentPhase = phase;
    onStatusChange({
      kind: "generating",
      attempt,
      maxAttempts,
      phase,
      label: labelWithElapsed(phase, label),
    });
  };

  // Time-based heartbeat: grammar-constrained tool generation often
  // fires ZERO streaming events until the full completion lands, so
  // relying on Agent events alone leaves the UI frozen on a single
  // label for 30+ seconds. The heartbeat serves two purposes:
  //   1. Advance the phase on a gentle schedule (preparing → drafting
  //      → tool-call) so the user sees the pipeline progress.
  //   2. Re-emit the SAME phase with an updated elapsed-time suffix
  //      on every new whole second, so even when the phase is stuck
  //      on "Designing the app…" the user sees (12s), (13s), (14s)
  //      ticking up — concrete evidence the run is alive.
  let lastTickedSec = 0;
  const heartbeatInterval = setInterval(() => {
    const elapsed = Date.now() - heartbeatStartedAt;
    const sec = Math.floor(elapsed / 1000);

    // First 1s: preparing. 1-4s: drafting (covers prompt eval + early
    // token gen). 4s+: tool-call (writing the structured call out).
    // Only advances if no real event has overtaken the target phase.
    if (elapsed >= 4000) {
      pushPhase("tool-call");
    } else if (elapsed >= 1000) {
      pushPhase("drafting");
    }

    // Re-emit the status with a refreshed elapsed label on every new
    // whole second. Avoids spamming React with 400ms-rate renders by
    // throttling to whole-second boundaries only.
    if (sec > lastTickedSec && sec > 0) {
      lastTickedSec = sec;
      onStatusChange({
        kind: "generating",
        attempt,
        maxAttempts,
        phase: currentPhase,
        label: labelWithElapsed(currentPhase),
      });
    }
  }, 400);

  // Shared onWritten callback used by both tools. The harness doesn't
  // care WHICH tool the model called — both paths funnel through the
  // same pipeline and produce the same MiniApp shape.
  const handleWritten = (app: MiniApp) => {
    writtenApp = app;
    // The file is on disk — flip to verifying so the user sees
    // progress between the write and the harness's final success
    // resolution.
    pushPhase("verifying");
  };

  // Build the tools list. Normally both write_mini_app and
  // patch_mini_app are exposed — but if the previous attempts have
  // burnt consecutive patch calls without landing a write, we drop
  // patch_mini_app entirely. Small models ignore "switch to
  // write_mini_app" hints in the retry prompt and keep trying
  // patches; stripping the tool from the grammar is the only
  // reliable way to force the escalation.
  const tools = [
    createWriteMiniAppTool({
      chatId,
      identity,
      onWritten: handleWritten,
    }),
  ];
  if (!dropPatchTool) {
    tools.push(
      createPatchMiniAppTool({
        chatId,
        identity,
        onWritten: handleWritten,
      }),
    );
  }

  const agent = new Agent(llama, {
    systemPrompt,
    tools,
    maxIterations: 1,
    thinking: false,
    alwaysThinks,
    systemPromptTools,
    nativeReasoning,
    maxGenerationTokens: MINIAPP_MAX_GENERATION_TOKENS,
    skipFinalForceText: true,
    // Opt into first-iteration streaming so text/thinking token events
    // reach the harness's phase tracker. Without this, Agent filters
    // them on the first iteration (to avoid flashing unhelpful pre-
    // tool-call text in chat mode) and the phase indicator freezes on
    // "Preparing…" for the entire llama completion.
    streamFirstIteration: true,
    // Kill Agent's chat-mode crutches that don't belong in artifact
    // generation:
    //   1. direct-search fallback — fires back-to-back completions
    //      that race llama.rn into "Context is busy" cascades
    //   2. chat-mode prompt suffixes — ~400 tokens of datetime +
    //      tool-guidance boilerplate that just confuses the model
    //      when the tool's job is to emit code, not answer
    //      questions about the web.
    disableDirectSearchFallback: true,
    suppressChatModePromptSuffixes: true,
    onEvent: (event: AgentEvent) => {
      if (event.type === "thinking") {
        pushPhase("thinking");
      } else if (event.type === "text") {
        // The model is streaming plain text. If we haven't seen a
        // tool call yet, treat this as the "drafting" phase so the
        // user knows SOMETHING is being produced. Skipped (no-op)
        // once we've already advanced to tool-call / writing.
        if (currentPhase === "preparing" || currentPhase === "thinking") {
          pushPhase("drafting");
        }
      } else if (event.type === "toolCall") {
        // Remember which tool the model actually called so the
        // main loop's escalation logic can detect patch-loops.
        if (toolUsedName === null) toolUsedName = event.name;
        emit({
          t: "toolCall",
          at: Date.now(),
          name: event.name,
          argsChars: safeJsonChars(event.args),
        });
        // Tool call parsed → the model has committed to producing
        // the program. Move into the tool-call phase; the actual
        // write lands shortly after in onWritten → "verifying".
        pushPhase("tool-call");
      } else if (event.type === "toolResult") {
        emit({
          t: "toolResult",
          at: Date.now(),
          isError: !!event.result.isError,
          contentChars: (event.result.content ?? "").length,
        });
        if (event.result.isError) {
          toolResultError = event.result.content;
        } else {
          // Successful tool result — the file is on disk. Push
          // "writing" explicitly in case onWritten didn't already
          // (e.g. tool returned ok before the side-effect landed).
          pushPhase("writing");
        }
      } else if (event.type === "error") {
        agentError = new Error(event.error);
      }
    },
  });

  const llamaStartAt = Date.now();
  emit({ t: "llamaStart", at: llamaStartAt, attempt });

  try {
    const raceOutcome = await raceWithTimeout(
      agent.run(userText).catch((err) => {
        agentError = err;
        return null;
      }),
      perAttemptTimeoutMs,
      cancelToken,
    );

    const llamaDurationMs = Date.now() - llamaStartAt;
    emit({
      t: "llamaEnd",
      at: Date.now(),
      attempt,
      durationMs: llamaDurationMs,
    });

    if (raceOutcome.kind === "cancelled") {
      return { kind: "cancelled" };
    }

    if (raceOutcome.kind === "timeout") {
      emit({
        t: "timeout",
        at: Date.now(),
        attempt,
        afterMs: raceOutcome.afterMs,
      });
      // Tell llama.rn to stop the native completion so we can start a new one.
      try {
        await llama.stopGeneration();
      } catch {}
      return {
        kind: "failure",
        reason: `Attempt ${attempt} timed out after ${raceOutcome.afterMs}ms`,
        thrownError: new HarnessTimeoutError(raceOutcome.afterMs),
        toolResultError: null,
        toolUsed: toolUsedName,
      };
    }

    // raceOutcome.kind === "ok"
    if (writtenApp) {
      return { kind: "success", app: writtenApp, toolUsed: toolUsedName };
    }

    // No app written. Figure out why.
    if (toolResultError) {
      return {
        kind: "failure",
        reason: toolResultError,
        thrownError: null,
        toolResultError,
        toolUsed: toolUsedName,
      };
    }

    if (agentError) {
      const msg =
        agentError instanceof Error
          ? agentError.message
          : String(agentError);
      return {
        kind: "failure",
        reason: msg,
        thrownError: agentError,
        toolResultError: null,
        toolUsed: toolUsedName,
      };
    }

    return {
      kind: "failure",
      reason:
        "The model didn't call write_mini_app. It may have replied in text only.",
      thrownError: null,
      toolResultError: null,
      toolUsed: toolUsedName,
    };
  } finally {
    // Always clear the heartbeat — leaking it would keep nudging the UI
    // after the attempt resolves.
    clearInterval(heartbeatInterval);
  }
}

function safeJsonChars(value: unknown): number {
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}
