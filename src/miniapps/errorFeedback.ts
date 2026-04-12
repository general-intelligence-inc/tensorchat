/**
 * Error feedback loop — renders retry prompt appendices from past
 * attempt records.
 *
 * This is where "the model failed" turns into "here is the specific
 * fix you should make". Every ValidationCode has a dedicated template
 * that produces a short, model-actionable block (hard-capped at 600
 * chars so it doesn't blow the 12k prompt budget).
 *
 * The templates embed the execution trace when available — the
 * "Reflexion with execution traces" pattern from recent research.
 * Instead of "runtime error", the model sees:
 *
 *   - which state keys the top-level program wrote
 *   - which state keys the render fn tried to read
 *   - which components the tree actually contained
 *   - the first caught error with its location
 *
 * This concrete signal is the single biggest reason a small model
 * can self-correct — vague error messages leave it guessing.
 */

import type { ExecutionTrace, ValidationIssue } from "./validator/types";

/**
 * Record of a past pipeline / generation attempt. The harness keeps
 * these in an array and passes them to `renderRetryAppendix` to build
 * the retry prompt for the next attempt.
 *
 * Minimal surface — deliberately NOT a superset of HarnessResult
 * because the composer only needs what goes in the prompt.
 */
export interface AttemptRecord {
  attempt: number;
  toolUsed: "write_mini_app" | "patch_mini_app" | null;
  programFingerprint: string | null;
  issue?: ValidationIssue;
  trace?: ExecutionTrace;
  /** The error message as delivered by the harness (e.g. "timeout"). */
  errorMessage?: string;
  errorKind?: string;
}

const MAX_APPENDIX_CHARS = 600;

/** Trim a string to a max length, appending an ellipsis if truncated. */
function trimTo(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

/** Summarize a list as "[a, b, c]" with "(none)" for empty. */
function summarizeList(list: readonly string[] | undefined): string {
  if (!list || list.length === 0) return "(none)";
  return "[" + list.slice(0, 8).join(", ") + (list.length > 8 ? ", …" : "") + "]";
}

/**
 * Render a retry appendix from an AttemptRecord.
 *
 * Returns a string that the system prompt can append verbatim. Always
 * ≤ MAX_APPENDIX_CHARS after assembly (any template that would exceed
 * is truncated character-by-character, not via ellipsis on a line).
 */
export function renderRetryAppendix(record: AttemptRecord): string {
  const issue = record.issue;
  const trace = record.trace;

  // Generic fallback if we don't have a structured issue (e.g. the
  // error came from llama.rn itself, not from the pipeline).
  if (!issue) {
    const msg = record.errorMessage ?? "Unknown error";
    return trimTo(
      "\n\n--- PREVIOUS ATTEMPT FAILED ---\n" +
        msg +
        "\n\nAnalyse the cause and call the tool again with a corrected program.",
      MAX_APPENDIX_CHARS,
    );
  }

  // Per-code templates. Each one is a small, crisp correction nudge.
  switch (issue.code) {
    case "args.missing_program":
      return trimTo(
        "\n\n--- PREVIOUS ATTEMPT FAILED ---\n" +
          "Your last tool call had NO `program` argument. You must " +
          "include a complete JavaScript program as a string in the " +
          "`program` field. Structure:\n" +
          "  write_mini_app({\n" +
          '    program: "tc.state.x = 0; tc.mount(function(){ return tc.column({gap:16},[...]); });"\n' +
          "  })",
        MAX_APPENDIX_CHARS,
      );

    case "args.program_empty":
      return trimTo(
        "\n\n--- PREVIOUS ATTEMPT FAILED ---\n" +
          "Your `program` argument was an empty string. You likely hit " +
          "the output token cap mid-generation. Keep the program tight " +
          "— under 2000 characters — and emit it as a single " +
          'tc.column([...]) with minimal whitespace. No explanatory ' +
          "comments in the code.",
        MAX_APPENDIX_CHARS,
      );

    case "clean.empty":
      return trimTo(
        "\n\n--- PREVIOUS ATTEMPT FAILED ---\n" +
          "Your `program` argument contained only markdown fences or " +
          "whitespace — no actual code. Put the JavaScript DIRECTLY in " +
          "the `program` string, not wrapped in ``` fences:\n" +
          '  program: "tc.state.x = 0; tc.mount(function(){...});"',
        MAX_APPENDIX_CHARS,
      );

    case "parse.syntax_error":
    case "smoke.parse_error":
      return trimTo(
        "\n\n--- PREVIOUS ATTEMPT FAILED ---\n" +
          "Your program had a JavaScript syntax error:\n" +
          issue.message +
          "\n\nCheck for unbalanced braces, missing commas, or stray " +
          "characters. Then call the tool again with the corrected program.",
        MAX_APPENDIX_CHARS,
      );

    case "static.no_mount":
    case "smoke.no_mount":
      return trimTo(
        "\n\n--- PREVIOUS ATTEMPT FAILED ---\n" +
          "Your program never called tc.mount(renderFn). Add this at the " +
          "end of the program:\n" +
          "  tc.mount(function() {\n" +
          "    return tc.column({ gap: 16 }, [ /* your UI */ ]);\n" +
          "  });\n" +
          "Then call the tool again.",
        MAX_APPENDIX_CHARS,
      );

    case "static.html_tags":
      return trimTo(
        "\n\n--- PREVIOUS ATTEMPT FAILED ---\n" +
          "Your program contained HTML tags. This mode does NOT use HTML. " +
          "Use ONLY tc.* primitives: tc.heading, tc.text, tc.button, " +
          "tc.input, tc.row, tc.column, tc.grid, tc.card, tc.list, " +
          "tc.toggle, tc.slider, tc.display. End with tc.mount(...).",
        MAX_APPENDIX_CHARS,
      );

    case "static.conditional_mount":
      return trimTo(
        "\n\n--- PREVIOUS ATTEMPT FAILED ---\n" +
          "Your program wrapped tc.mount inside a conditional branch. " +
          "Move the tc.mount call to the top level so it runs " +
          "unconditionally.",
        MAX_APPENDIX_CHARS,
      );

    case "static.program_too_big":
      return trimTo(
        "\n\n--- PREVIOUS ATTEMPT FAILED ---\n" +
          "Your program was too long. Shrink it: trim unused code, fold " +
          "repeated patterns into loops, and drop features the user didn't " +
          "ask for. Keep it under 2500 characters where possible.",
        MAX_APPENDIX_CHARS,
      );

    case "smoke.top_level_threw":
      return trimTo(
        "\n\n--- PREVIOUS ATTEMPT FAILED ---\n" +
          "Your program threw an error BEFORE tc.mount was called:\n" +
          issue.message +
          "\n\nCheck your state initialization and any helper functions " +
          "declared at the top level. Common cause: referencing a " +
          "variable before it's defined.",
        MAX_APPENDIX_CHARS,
      );

    case "smoke.mount_not_function":
      return trimTo(
        "\n\n--- PREVIOUS ATTEMPT FAILED ---\n" +
          "tc.mount was called but its argument was not a function. " +
          "Pass a render function:\n" +
          "  tc.mount(function() { return tc.column(...); });",
        MAX_APPENDIX_CHARS,
      );

    case "smoke.render_threw": {
      const traceLines: string[] = [];
      if (trace) {
        traceLines.push(
          "- state keys set at top: " + summarizeList(trace.stateKeysWritten),
        );
        traceLines.push(
          "- state keys read by render: " + summarizeList(trace.stateKeysRead),
        );
        traceLines.push(
          "- components visited: " + summarizeList(trace.visitedComponentTypes),
        );
      }
      return trimTo(
        "\n\n--- PREVIOUS ATTEMPT FAILED ---\n" +
          "Your render function crashed during its FIRST invocation:\n" +
          issue.message +
          (traceLines.length > 0
            ? "\n\nWhat the stub saw before the crash:\n" + traceLines.join("\n")
            : "") +
          "\n\nFix the specific bug. Do NOT rewrite unrelated code.",
        MAX_APPENDIX_CHARS,
      );
    }

    case "smoke.render_returned_nothing":
      return trimTo(
        "\n\n--- PREVIOUS ATTEMPT FAILED ---\n" +
          "Your render function returned undefined or null. It must " +
          "RETURN a tc.* component. Example:\n" +
          "  tc.mount(function() {\n" +
          "    return tc.column({ gap: 16 }, [ /* ... */ ]);\n" +
          "  });",
        MAX_APPENDIX_CHARS,
      );

    case "smoke.render_invalid_tree":
    case "schema.unknown_component":
    case "schema.unknown_prop":
    case "schema.wrong_prop_type":
    case "schema.missing_required_prop":
    case "schema.children_not_allowed":
    case "schema.invalid_enum_value": {
      const hint =
        issue.suggestions && issue.suggestions.length > 0
          ? "\n\nSuggestion: " + issue.suggestions[0]
          : "";
      return trimTo(
        "\n\n--- PREVIOUS ATTEMPT FAILED ---\n" +
          issue.message +
          hint +
          "\n\nFix the specific prop/component and call the tool again.",
        MAX_APPENDIX_CHARS,
      );
    }

    case "smoke.timeout":
      return trimTo(
        "\n\n--- PREVIOUS ATTEMPT FAILED ---\n" +
          issue.message +
          "\n\nKeep initialization cheap — no heavy loops or large data " +
          "generation at the top level. Use tc.state + render on demand.",
        MAX_APPENDIX_CHARS,
      );

    case "patch.find_missing":
      return trimTo(
        "\n\n--- PATCH FAILED ---\n" +
          "Your `find` text was NOT found verbatim in the current program. " +
          "Patch matching is whitespace-sensitive — every space, newline, " +
          "and indent must match EXACTLY.\n\n" +
          "RECOMMENDED: switch to write_mini_app and emit the full updated " +
          "program in one shot. This is more reliable than hunting for the " +
          "exact substring on a retry. The change you're making only needs " +
          "a few lines — everything else can be copied verbatim from the " +
          "Current program block.",
        MAX_APPENDIX_CHARS,
      );

    case "patch.find_ambiguous":
      return trimTo(
        "\n\n--- PATCH FAILED ---\n" +
          issue.message +
          "\n\nEither make `find` longer (include more surrounding lines) " +
          "so it matches exactly ONE location, or switch to write_mini_app " +
          "with the full updated program.",
        MAX_APPENDIX_CHARS,
      );

    case "patch.too_large":
      return trimTo(
        "\n\n--- PATCH FAILED ---\n" +
          "Your replacement was much larger than the original text. For " +
          "large changes, use write_mini_app with the FULL updated " +
          "program instead of patch_mini_app.",
        MAX_APPENDIX_CHARS,
      );

    case "patch.noop":
      return trimTo(
        "\n\n--- PATCH FAILED ---\n" +
          "Your `find` and `replace` were identical. Make a concrete " +
          "change, or call write_mini_app if no change is needed.",
        MAX_APPENDIX_CHARS,
      );

    case "patch.find_too_short":
    case "patch.find_too_long":
    case "patch.program_too_big":
      return trimTo(
        "\n\n--- PATCH FAILED ---\n" +
          issue.message +
          "\n\nAdjust the patch size and try again, or switch to " +
          "write_mini_app if the change is too big for a patch.",
        MAX_APPENDIX_CHARS,
      );

    case "write.disk_error":
      return trimTo(
        "\n\n--- PREVIOUS ATTEMPT FAILED ---\n" +
          issue.message +
          "\n\nTry the tool again — this is usually transient.",
        MAX_APPENDIX_CHARS,
      );

    // Default fallback for any code we didn't match explicitly.
    default:
      return trimTo(
        "\n\n--- PREVIOUS ATTEMPT FAILED ---\n" +
          issue.message +
          "\n\nAnalyse the cause and call the tool again with a " +
          "corrected program.",
        MAX_APPENDIX_CHARS,
      );
  }
}

/**
 * Minimal template the escalation hint gives the model on the 3rd
 * attempt. The goal is: stop asking the model to generate from
 * scratch; give it a working skeleton to MINIMALLY adapt. Small
 * models are much better at filling in a blank than at producing
 * a complete program when they've already failed twice.
 */
const ESCALATION_TEMPLATE = `tc.state.x = 0;
tc.mount(function() {
  return tc.column({ gap: 16, padding: 20 }, [
    tc.heading({ text: "Title" }),
    tc.text({ text: "Body" }),
    tc.button({ label: "Tap", onClick: function() { tc.state.x++; } })
  ]);
});`;

/**
 * Detect whether ALL previous attempts failed with "empty program"
 * family errors — if so, the model is clearly confused about how to
 * fill the `program` field and we should hand it a fully-fleshed
 * template instead of asking for more generation.
 */
function allEmptyProgramFailures(records: AttemptRecord[]): boolean {
  if (records.length === 0) return false;
  return records.every((r) => {
    const code = r.issue?.code;
    if (!code) {
      // No structured code — check the message for common empty-
      // program phrases.
      const msg = (r.errorMessage ?? "").toLowerCase();
      return (
        msg.includes("empty") ||
        msg.includes("no `program`") ||
        msg.includes("markdown fence")
      );
    }
    return (
      code === "args.missing_program" ||
      code === "args.program_empty" ||
      code === "clean.empty"
    );
  });
}

/**
 * Compose a multi-attempt retry appendix when there are several failed
 * attempts.
 *
 * Strategy by attempt count:
 *
 *   1 failure  → regular retry appendix for that one failure
 *   2 failures → both appendices stacked + "escalation" hint
 *                (swap tools, try a smaller program, etc.)
 *   3+ failures, all of them "empty program" family
 *              → abandon free-form generation. Hand the model a
 *                ready-to-use minimal skeleton and tell it to
 *                substitute content for the user's request. This
 *                is the last-resort path — when the model clearly
 *                can't assemble a program under its own steam.
 *
 * Total length stays under MAX_APPENDIX_CHARS * 2 so the prompt
 * budget isn't blown.
 */
export function renderMultiAttemptAppendix(records: AttemptRecord[]): string {
  if (records.length === 0) return "";
  if (records.length === 1) return renderRetryAppendix(records[0]);

  const latest = records[records.length - 1];
  const previous = records[records.length - 2];

  // Last-resort template path — the model has failed 2+ times with
  // empty-program errors. Stop asking for free generation, hand it
  // a working skeleton.
  if (records.length >= 2 && allEmptyProgramFailures(records)) {
    return trimTo(
      "\n\n--- LAST RESORT ---\n" +
        "Your previous " +
        records.length +
        " attempts produced an empty `program` field. Stop trying to " +
        "generate a complete program from scratch. Instead, COPY this " +
        "template into the `program` field EXACTLY, then modify the " +
        "component contents to match the user's request:\n\n" +
        ESCALATION_TEMPLATE +
        "\n\nCall write_mini_app with the above as your starting point. " +
        "The `program` field must contain REAL JavaScript — no fences, " +
        "no labels, no empty strings.",
      MAX_APPENDIX_CHARS * 2,
    );
  }

  const body =
    renderRetryAppendix(previous) +
    "\n\n" +
    renderRetryAppendix(latest) +
    "\n\n--- ESCALATION ---\n" +
    "Two attempts failed. If you've been patching, switch to " +
    "write_mini_app with the FULL updated program. Keep it minimal.";
  return trimTo(body, MAX_APPENDIX_CHARS * 2);
}
