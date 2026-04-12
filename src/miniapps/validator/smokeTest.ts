/**
 * Pre-flight headless smoke test for mini-app programs.
 *
 * This is the single biggest structural fix from the v2 redesign: no
 * program is written to disk until we've executed it against a stub
 * tc runtime and confirmed it actually mounts a valid tree. The
 * existing "verifyLoop" (post-write runtime error capture) stays as
 * a backstop, but the smoke test closes the silent-failure gap where
 * a program parses fine, passes regex checks, and then renders a
 * blank WebView because mount was never called (or was called with a
 * non-function, or the render fn returned undefined, or the tree had
 * unknown components).
 *
 * Implementation: Plan C — `new Function` shim.
 *
 *   - We build a wrapper function whose body is:
 *       "use strict";
 *       var tc = arguments[0];
 *       var window = undefined;
 *       var document = undefined;
 *       var localStorage = undefined;
 *       var fetch = undefined;
 *       var XMLHttpRequest = undefined;
 *       ${program}
 *
 *   - We run it under a try/catch that distinguishes top-level errors
 *     from render-time errors.
 *   - We enforce a JS-level deadline by checking the clock at entry
 *     and bailing the outer Promise if the whole thing hasn't returned
 *     in 300ms.
 *
 * Plan C is NOT a security sandbox — the program still runs in the
 * same JS VM. The WebView is the real security boundary. The smoke
 * test's job is to catch bugs, not malicious code.
 *
 * Performance budget: <50ms for a typical ~1500-char program. The
 * cost is `new Function` compilation (~10ms) + running the program
 * (~5-20ms) + walking the tree (~2-5ms). Well inside our 300-500ms
 * budget.
 */

import {
  validateTree,
  collectComponentTypes,
} from "./schema";
import { createTcStub } from "./tcStub";
import type { ExecutionTrace, SmokeResult, ValidationIssue } from "./types";

const DEFAULT_SMOKE_TIMEOUT_MS = 300;

/**
 * Run a headless smoke test on a mini-app program. Returns a
 * discriminated-union SmokeResult that downstream pipeline steps
 * translate into ValidationIssues with the right retry-prompt shape.
 *
 * This function is synchronous internally (new Function + invoke),
 * but we return a Promise so a future QuickJS-backed implementation
 * can be an async drop-in replacement without changing callers.
 */
export async function smokeTest(
  program: string,
  opts: { timeoutMs?: number } = {},
): Promise<SmokeResult> {
  const startedAt = Date.now();
  const deadline = startedAt + (opts.timeoutMs ?? DEFAULT_SMOKE_TIMEOUT_MS);

  const { stub, getObservation, enterRenderMode } = createTcStub();

  // Parse + compile the program inside a fresh function scope. We shadow
  // dangerous globals (window, document, fetch, etc.) so the program
  // can't accidentally touch the outer environment even in this JS VM.
  // Any parse error surfaces here before execution.
  let compiled: ((tc: unknown) => void) | null = null;
  try {
    // eslint-disable-next-line no-new-func
    compiled = new Function(
      "tc",
      '"use strict";\n' +
        "var window = undefined;\n" +
        "var document = undefined;\n" +
        "var localStorage = undefined;\n" +
        "var fetch = undefined;\n" +
        "var XMLHttpRequest = undefined;\n" +
        "var WebSocket = undefined;\n" +
        "var navigator = undefined;\n" +
        "var Notification = undefined;\n" +
        "var alert = undefined;\n" +
        "var prompt = undefined;\n" +
        "var confirm = undefined;\n" +
        "\n" +
        program,
    ) as (tc: unknown) => void;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // new Function's SyntaxError messages are not super helpful but
    // they're enough for the retry prompt to tell the model WHAT
    // kind of issue to look for (unexpected token, missing brace, etc).
    return {
      kind: "parse_error",
      message: msg,
      durationMs: Date.now() - startedAt,
    };
  }

  // Execute the program's top-level code under try/catch. This populates
  // the stub observation with mount calls, state writes, and save/load
  // access. Errors from descriptor factories themselves are rare (they
  // always return `{ __tc: type, ...props }`), so most top-level errors
  // come from user code before the mount call.
  try {
    compiled(stub);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    return {
      kind: "top_level_threw",
      message: msg,
      stack,
      durationMs: Date.now() - startedAt,
    };
  }

  const obs = getObservation();

  // Must have called mount.
  if (!obs.mountCalled) {
    return {
      kind: "no_mount",
      message:
        "Your program never called tc.mount(renderFn). Add " +
        "tc.mount(function() { return tc.column({ gap: 16 }, [ ... ]); }); " +
        "at the end.",
      trace: observationToTrace(obs, null, []),
      durationMs: Date.now() - startedAt,
    };
  }

  // Mount must have been called with a function.
  if (!obs.mountArgIsFunction || !obs.mountRenderFn) {
    return {
      kind: "mount_not_function",
      message:
        "tc.mount(...) was called but its argument was not a function. " +
        "Pass a render function: tc.mount(function() { return tc.column(...); });",
      durationMs: Date.now() - startedAt,
    };
  }

  // Check the budget before invoking render — if compiling+top-level
  // already blew the deadline, don't make it worse.
  if (Date.now() > deadline) {
    return {
      kind: "timeout",
      afterMs: Date.now() - startedAt,
    };
  }

  // Transition the stub into render phase so state reads get recorded.
  enterRenderMode();

  // Invoke the captured render fn exactly ONCE. This is where most
  // real bugs surface: undefined state keys, typo'd prop names, etc.
  let tree: unknown;
  try {
    tree = obs.mountRenderFn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    return {
      kind: "render_threw",
      message: msg,
      stack,
      trace: observationToTrace(obs, null, []),
      durationMs: Date.now() - startedAt,
    };
  }

  if (tree == null) {
    return {
      kind: "render_returned_nothing",
      message:
        "Your render function returned " +
        (tree === null ? "null" : "undefined") +
        ". It must RETURN a tc.* component (typically tc.column or tc.card).",
      trace: observationToTrace(obs, null, []),
      durationMs: Date.now() - startedAt,
    };
  }

  // Validate the full tree against the component schema. If any node
  // has unknown props / wrong types / unknown component type, surface
  // the FIRST issue (retry prompts work better with one clear error
  // than a wall of complaints).
  const issues: ValidationIssue[] = validateTree(tree);
  if (issues.length > 0) {
    const first = issues[0];
    return {
      kind: "render_invalid_tree",
      message: first.message,
      treePath: first.location?.treePath ?? "root",
      trace: observationToTrace(obs, extractRootTreeType(tree), []),
      durationMs: Date.now() - startedAt,
    };
  }

  // Collect the set of component types actually used so the retry
  // prompt (on future failures) can reference concrete components.
  const typesSet = collectComponentTypes(tree);
  const visitedComponentTypes = Array.from(typesSet);
  const rootTreeType = extractRootTreeType(tree);

  // Final deadline check.
  if (Date.now() > deadline) {
    return {
      kind: "timeout",
      afterMs: Date.now() - startedAt,
    };
  }

  return {
    kind: "ok",
    trace: observationToTrace(obs, rootTreeType, visitedComponentTypes),
    durationMs: Date.now() - startedAt,
    tree,
  };
}

/**
 * Derive the root component type (e.g. "column", "card") from the
 * return value of the render fn. Returns null if the tree doesn't
 * start with a descriptor.
 */
function extractRootTreeType(tree: unknown): string | null {
  if (tree && typeof tree === "object" && !Array.isArray(tree)) {
    const t = (tree as Record<string, unknown>).__tc;
    if (typeof t === "string") return t;
  }
  return null;
}

/**
 * Convert the mutable stub observation into an immutable ExecutionTrace
 * suitable for inclusion in a retry prompt.
 */
function observationToTrace(
  obs: ReturnType<ReturnType<typeof createTcStub>["getObservation"]>,
  rootTreeType: string | null,
  visitedComponentTypes: string[],
): ExecutionTrace {
  return {
    mountCalled: obs.mountCalled,
    renderInvocations: obs.mountRenderFn ? 1 : 0,
    stateKeysWritten: [...obs.topLevelStateWrites],
    stateKeysRead: [...obs.renderStateReads],
    topLevelSaves: obs.topLevelSaves.map((s) => ({ key: s.key })),
    rootTreeType,
    visitedComponentTypes,
  };
}

/**
 * Convenience: run the smoke test and return a terminal ValidationIssue
 * if it failed, or null if it succeeded. Used by the tool pipeline so
 * callers don't have to translate SmokeResult kinds individually.
 *
 * This function is intentionally strict about error messages — the
 * messages are what the model sees verbatim in the retry prompt, so
 * phrasing matters.
 */
export async function smokeTestAsIssue(
  program: string,
  opts?: { timeoutMs?: number },
): Promise<{ ok: true; result: SmokeResult } | { ok: false; issue: ValidationIssue }> {
  const result = await smokeTest(program, opts);

  switch (result.kind) {
    case "ok":
      return { ok: true, result };

    case "parse_error":
      return {
        ok: false,
        issue: {
          code: "smoke.parse_error",
          message:
            "Program failed to parse: " +
            result.message +
            ". Check for unbalanced braces/brackets or typos.",
        },
      };

    case "top_level_threw":
      return {
        ok: false,
        issue: {
          code: "smoke.top_level_threw",
          message:
            "Program threw an error before tc.mount was called: " +
            result.message +
            ". Check your state initialization and helper functions.",
          details: { stack: result.stack },
        },
      };

    case "no_mount":
      return {
        ok: false,
        issue: {
          code: "smoke.no_mount",
          message: result.message,
        },
      };

    case "mount_not_function":
      return {
        ok: false,
        issue: {
          code: "smoke.mount_not_function",
          message: result.message,
        },
      };

    case "render_threw":
      return {
        ok: false,
        issue: {
          code: "smoke.render_threw",
          message:
            "Your render function threw: " +
            result.message +
            ". Fix the specific bug — do not rewrite unrelated code.",
          details: {
            stack: result.stack,
            stateKeysWritten: result.trace.stateKeysWritten,
            stateKeysRead: result.trace.stateKeysRead,
            visitedComponentTypes: result.trace.visitedComponentTypes,
          },
        },
      };

    case "render_returned_nothing":
      return {
        ok: false,
        issue: {
          code: "smoke.render_returned_nothing",
          message: result.message,
        },
      };

    case "render_invalid_tree":
      return {
        ok: false,
        issue: {
          code: "smoke.render_invalid_tree",
          message: result.message,
          location: { treePath: result.treePath },
        },
      };

    case "timeout":
      return {
        ok: false,
        issue: {
          code: "smoke.timeout",
          message:
            "Smoke test timed out after " +
            result.afterMs +
            "ms. Your program probably has an infinite loop or excessive " +
            "work at the top level. Keep initialization cheap.",
        },
      };
  }
}
