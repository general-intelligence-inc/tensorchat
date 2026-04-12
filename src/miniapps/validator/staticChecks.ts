/**
 * Static validators for mini-app programs.
 *
 * These run BEFORE the smoke test as a cheap first-pass filter. They
 * catch the obvious cases (empty program, JS syntax error, raw HTML
 * tags, missing tc.mount, conditional mount, oversized program) so the
 * smoke test never wastes its JS sandbox budget on programs that are
 * obviously broken.
 *
 * Every function is pure — no disk, no network, no state. This makes
 * them trivially unit-testable and safe to call from either the
 * main thread or a worker.
 */

import type { ValidationIssue } from "./types";

/**
 * Hard upper bound on program size (chars) the pipeline will accept.
 * Anything larger almost certainly blew the 2048-token output budget
 * and is corrupted mid-way through. Keeping this strict prevents us
 * from loading a broken giant program into the smoke test only to
 * watch it parse-error out after 200ms.
 */
export const MAX_PROGRAM_CHARS = 18_000;

/**
 * Strip common escaping artifacts from the raw `program` argument the
 * model emitted. Handles:
 *
 *   - Markdown code fences: ```javascript ... ```
 *   - Leading label markers: [js] / [program] / [tc]
 *   - Trailing whitespace
 *
 * Lifted out of `writeMiniApp.ts` so both tools (write + patch) and
 * the pipeline unit tests can share the exact same implementation.
 */
export function cleanProgramField(raw: string): string {
  if (!raw) return "";
  let program = raw;

  // Unwrap ```javascript ... ``` or ```js ... ``` or ```html ... ``` etc.
  const wholeFence = program.match(
    /^\s*```(?:javascript|js|html|tc)?\s*\n?([\s\S]*?)\n?```\s*$/i,
  );
  if (wholeFence) {
    program = wholeFence[1];
  }

  // Strip a leading `[js]` / `[program]` label.
  program = program.replace(/^\s*\[(?:js|program|tc)\]\s*\n?/i, "");

  return program.trim();
}

/**
 * Parse-check a program via `new Function(...)`. Returns null on
 * success or a ValidationIssue describing the syntax error.
 *
 * Note: `new Function` only does syntax validation — it doesn't EXECUTE
 * the program. A program that calls an undefined function or reads a
 * missing property will still pass this check. Those failures are
 * caught by the smoke test one step later.
 */
export function parseJs(program: string): ValidationIssue | null {
  try {
    // eslint-disable-next-line no-new-func
    new Function(program);
    return null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      code: "parse.syntax_error",
      message:
        "Program has a JavaScript syntax error: " +
        msg +
        ". Re-emit the corrected program.",
    };
  }
}

/**
 * Check that the program contains a `tc.mount(` call. This is a
 * regex-level sanity check — the real test that mount is actually
 * INVOKED lives in the smoke test. This check catches programs that
 * don't even mention mount, which is 90% of the "forgot to mount"
 * failure mode.
 */
export function hasMountCall(program: string): ValidationIssue | null {
  if (/tc\s*\.\s*mount\s*\(/.test(program)) return null;
  return {
    code: "static.no_mount",
    message:
      "The program never calls `tc.mount(renderFn)`. Every mini-app must " +
      "call tc.mount at the end with a render function that returns a tc.* " +
      "tree. Re-emit with the mount call included.",
  };
}

/**
 * Reject programs containing literal HTML tags. The 2B model sometimes
 * reverts to DOM muscle memory and tries to pack `<script>` / `<style>`
 * / `<body>` / etc. into the program field. Catching this early gives
 * the model a crisp error it can act on.
 */
export function noHtmlTags(program: string): ValidationIssue | null {
  if (!/<\/?(html|body|head|script|style|link|meta)[\s>]/i.test(program)) {
    return null;
  }
  return {
    code: "static.html_tags",
    message:
      "The program contains HTML tags like <script>/<style>/<body>. This " +
      "mode does NOT use HTML. Rewrite the program using ONLY tc.* " +
      "primitives (tc.heading, tc.button, tc.row, tc.column, tc.grid, etc.) " +
      "and call tc.mount() at the end.",
  };
}

/**
 * Reject programs that wrap `tc.mount` directly inside a conditional
 * at the TOP LEVEL of the program.
 *
 * The goal of this lint is narrow: catch the pathological pattern
 * `if (Math.random() > 0.5) tc.mount(...)` that would fool the
 * smoke test half the time. We do NOT want to false-positive on
 * programs that define helper functions containing `if` statements
 * and happen to have those helpers positioned just before the
 * mount call (e.g. a stopwatch with `function tick() { if (...) }`
 * immediately above `tc.mount(...)`).
 *
 * Strategy:
 *   1. Split the program into top-level chunks at unindented (col=0)
 *      braces / semicolons — lines that start helper functions and
 *      lines that contain top-level statements.
 *   2. Find the chunk that contains the first tc.mount call.
 *   3. Only flag if that specific chunk begins with `if (...)` or
 *      `?:` at column 0.
 *
 * This is a best-effort heuristic — it can miss unusual formatting
 * (e.g. `var x = {}; if (x) tc.mount(...)` on a single line) but
 * it's robust against the common false positives (helper functions
 * with internal `if` blocks just before mount).
 */
export function noConditionalMount(program: string): ValidationIssue | null {
  // Split program into lines and find the line containing the first
  // tc.mount call. Then walk backwards to the start of the top-level
  // statement that line belongs to (= the nearest previous line that
  // starts at col 0 and isn't inside a brace block).
  const lines = program.split("\n");
  let mountLineIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/tc\s*\.\s*mount\s*\(/.test(lines[i])) {
      mountLineIdx = i;
      break;
    }
  }
  if (mountLineIdx < 0) return null;

  // Walk backwards through lines tracking brace depth. A "top-level
  // statement" starts at a line where our running brace depth is 0
  // AND the previous line's depth was also 0 (or it's the start of
  // the program). We're looking for the statement that OWNS the
  // mount call.
  let depth = 0;
  let stmtStartLine = mountLineIdx;
  for (let i = mountLineIdx; i >= 0; i--) {
    const line = lines[i];
    // Count braces on this line — closing braces increase our
    // "backward depth" as we walk back, opening braces decrease it.
    // When depth drops to 0 and the line has content at col 0 that
    // looks like the START of a statement, we've found the owning
    // top-level chunk.
    for (let c = line.length - 1; c >= 0; c--) {
      const ch = line[c];
      if (ch === "}") depth++;
      else if (ch === "{") depth--;
    }
    // When walking backwards, we're inside a block if depth > 0.
    // A line with depth <= 0 that starts flush-left is a statement
    // boundary candidate.
    if (depth <= 0 && /^\S/.test(line)) {
      stmtStartLine = i;
      break;
    }
  }

  // Now check whether the owning top-level statement STARTS with a
  // conditional keyword. We take the first non-blank content of the
  // statement chunk and look for `if (` or `?` at the start.
  const stmtText = lines.slice(stmtStartLine, mountLineIdx + 1).join(" ").trim();
  const startsWithConditional = /^(if\s*\(|.*\?\s*tc\s*\.\s*mount)/.test(
    stmtText.slice(0, 60),
  );
  if (!startsWithConditional) return null;

  return {
    code: "static.conditional_mount",
    message:
      "Your program calls tc.mount inside a conditional branch. Move the " +
      "tc.mount call to the top level of the program so it runs unconditionally.",
  };
}

/**
 * Check program size against the MAX_PROGRAM_CHARS cap.
 */
export function checkProgramSize(program: string): ValidationIssue | null {
  if (program.length <= MAX_PROGRAM_CHARS) return null;
  return {
    code: "static.program_too_big",
    message:
      `Program is ${program.length} characters, over the ${MAX_PROGRAM_CHARS}-char ` +
      `limit. Shrink the program — trim unused code, fold repeated patterns ` +
      `into a loop, or drop a feature the user didn't ask for.`,
  };
}

/**
 * Run all static checks in order. Returns the FIRST issue that fires
 * (short-circuits — we want the model to see one clear error, not a
 * list of overlapping ones).
 *
 * Order matters: we run the HTML-tag check BEFORE the JS parse check
 * because raw HTML tags (`<script>`, `<body>`) produce syntax errors
 * when `new Function` tries to parse them, but the generic
 * "Unexpected token '<'" message is useless to the model. The HTML
 * check gives a specific "this mode does not use HTML" error that's
 * directly actionable.
 */
export function runStaticChecks(program: string): ValidationIssue | null {
  if (!program || program.trim().length === 0) {
    return {
      code: "clean.empty",
      message:
        "The `program` argument is empty after cleanup. Emit a JavaScript " +
        "program that calls `tc.mount(renderFn)` at the end.",
    };
  }

  const sizeIssue = checkProgramSize(program);
  if (sizeIssue) return sizeIssue;

  // HTML first — specific "no HTML" message is more helpful than the
  // syntax error parseJs would produce on the raw '<'.
  const htmlIssue = noHtmlTags(program);
  if (htmlIssue) return htmlIssue;

  const parseIssue = parseJs(program);
  if (parseIssue) return parseIssue;

  const mountIssue = hasMountCall(program);
  if (mountIssue) return mountIssue;

  const condIssue = noConditionalMount(program);
  if (condIssue) return condIssue;

  return null;
}
