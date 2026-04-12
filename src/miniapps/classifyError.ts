/**
 * Pure error classification for the mini-app harness.
 *
 * Extracted from `harness.ts` so it can be unit-tested in Node
 * without pulling in Agent / llamaAdapter / llama.rn. The harness
 * itself re-exports `classifyError` and `HarnessTimeoutError` /
 * `HarnessCancelledError` from here for backwards compatibility.
 *
 * Classification order (first match wins):
 *
 *   1. Structural harness errors (HarnessTimeoutError, HarnessCancelledError)
 *   2. llama.rn errors via llamaErrorCatalog.ts (context busy, overflow,
 *      model-released, native-crash, stop-requested)
 *   3. Pipeline "empty program" family (clean.empty, args.missing_program,
 *      args.program_empty) — treated as tool-validation so cooldowns
 *      are short AND so the compaction level gets bumped on retry
 *   4. Other tool-validation heuristics (wrapper tags, <script>, etc.)
 *   5. Model-silent (the model didn't call the tool at all)
 *   6. Hard-failure (disk write failed, model unloaded, etc.)
 *   7. Fallback: "unknown"
 */

import { classifyLlamaError } from "./llamaErrorCatalog";

export type ErrorClass =
  | "context-busy"
  | "timeout"
  | "tool-validation"
  | "model-silent"
  | "context-overflow"
  | "hard-failure"
  | "unknown";

/**
 * Thrown by the harness's `raceWithTimeout` primitive when a single
 * attempt's work promise exceeds its deadline. Distinct class so
 * `classifyError` can identify timeouts without string matching.
 */
export class HarnessTimeoutError extends Error {
  constructor(public readonly afterMs: number) {
    super(`Harness operation timed out after ${afterMs}ms`);
    this.name = "HarnessTimeoutError";
  }
}

/**
 * Thrown by the harness when the cancellation token fires while a
 * single attempt is mid-flight. The harness top-level catches this
 * and returns a "cancelled" HarnessResult — by the time a
 * cancellation error reaches `classifyError`, something is wrong and
 * we fall back to "unknown".
 */
export class HarnessCancelledError extends Error {
  constructor() {
    super("Harness operation cancelled");
    this.name = "HarnessCancelledError";
  }
}

/**
 * Map an error (thrown OR surfaced via the agent's `toolResult.isError`
 * channel) into one of the known ErrorClass kinds. The classification
 * drives the next-attempt strategy in the harness retry loop.
 *
 * Pure function — no side effects, safe to unit test.
 */
export function classifyError(
  err: unknown,
  toolResultError: string | null,
): ErrorClass {
  if (err instanceof HarnessTimeoutError) return "timeout";
  if (err instanceof HarnessCancelledError) {
    // Cancelled isn't an ErrorClass kind — the harness top-level
    // handles cancellation separately. Return "unknown" if it ever
    // leaks here.
    return "unknown";
  }

  // v2: try the centralized llama.rn error catalog first. This
  // replaces ad-hoc substring checks on individual error texts with
  // a single canonical catalog maintained in llamaErrorCatalog.ts.
  const llamaClass = classifyLlamaError(err ?? toolResultError);
  if (llamaClass) {
    switch (llamaClass.kind) {
      case "context-busy":
        return "context-busy";
      case "context-overflow":
        return "context-overflow";
      case "model-released":
      case "no-model-loaded":
      case "native-crash":
        return "hard-failure";
      case "stop-requested":
        return "unknown"; // top-level cancel path handles this
    }
  }

  const rawMessage =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : err != null
          ? String(err)
          : toolResultError ?? "";

  const msg = rawMessage.toLowerCase();

  // Pipeline "empty program" family — the model made a tool call but
  // produced nothing usable in the `program` field. These map to
  // "tool-validation" for cooldown purposes but they're important
  // enough to detect explicitly so the harness can bump the compaction
  // level (shorter prompt = more output budget → less likely to hit
  // the token cap mid-program).
  if (
    msg.includes("no `program` argument") ||
    msg.includes("was an empty string") ||
    msg.includes("contained only markdown fences") ||
    msg.includes("empty after cleanup") ||
    msg.includes("program field was empty")
  ) {
    return "tool-validation";
  }

  // Tool-validation (pipeline ValidationCodes arrive here via
  // toolResultError as plain strings). The specific codes aren't
  // exposed yet — the message contains the validator's error text
  // which the legacy heuristics still handle well enough for cooldown
  // selection.
  if (
    msg.includes("wrapper tag") ||
    msg.includes("[css]") ||
    msg.includes("[js]") ||
    msg.includes("<script") ||
    msg.includes("<style") ||
    msg.includes("malformed") ||
    msg.includes("invalid")
  ) {
    return "tool-validation";
  }
  if (
    msg.includes("didn't call write_mini_app") ||
    msg.includes("replied in text only") ||
    msg.includes("didn't call the tool") ||
    msg.includes("didn't produce an app")
  ) {
    return "model-silent";
  }
  if (
    msg.includes("released") ||
    msg.includes("no model loaded") ||
    msg.includes("failed to write")
  ) {
    return "hard-failure";
  }
  return "unknown";
}
