/**
 * Pure find/replace patcher for mini-app programs.
 *
 * Used by `patch_mini_app` to apply a model-supplied search string and
 * produce a new program. Before returning the patched program, this
 * function enforces a strict set of invariants so the 2B model can't
 * accidentally destroy the file with an ambiguous or degenerate patch:
 *
 *   1. `find` must be non-empty
 *   2. `find` must not be the whole program (that's a rewrite — use
 *      write_mini_app instead)
 *   3. `find` must be at least 8 characters long (avoids accidental
 *      matches on trivial substrings like "0" or ", ")
 *   4. `find` must be at most 1500 characters long (keeps patches
 *      small and targeted)
 *   5. `find` must occur EXACTLY ONCE in the current program (whitespace-
 *      sensitive); zero matches → find_missing, >1 → find_ambiguous
 *   6. `find` must not equal `replace` (that's a noop)
 *   7. `replace.length <= find.length × 4` (larger replacements mean
 *      the model is effectively rewriting; escalate to write_mini_app)
 *   8. The resulting program must be ≤ MAX_PROGRAM_CHARS (18k)
 *
 * Each invariant maps to a specific ValidationCode so the retry
 * prompt composer can give the model a targeted diagnostic.
 *
 * Implementation notes:
 *
 * - We use `indexOf` twice to count matches (matches <= 2 is all we
 *   need to know to distinguish zero/one/many). For very long programs
 *   this is still O(n).
 * - We record the line numbers of matches for the ambiguous case so
 *   the retry prompt can say "matches at lines 12 and 34" instead of
 *   just "matches more than once".
 * - The function is pure — no I/O, no globals. Safe to unit-test.
 */

import type { ValidationIssue } from "./types";

const MIN_FIND_CHARS = 8;
const MAX_FIND_CHARS = 1500;
const MAX_REPLACE_MULTIPLIER = 4;
const MAX_PROGRAM_CHARS = 18_000;

export interface ApplyPatchSuccess {
  ok: true;
  program: string;
  /** 1-indexed line number where the match started (useful for UI). */
  matchLine: number;
}

export interface ApplyPatchFailure {
  ok: false;
  issue: ValidationIssue;
}

export type ApplyPatchResult = ApplyPatchSuccess | ApplyPatchFailure;

/**
 * Count occurrences of `needle` inside `haystack` (non-overlapping).
 * Returns early as soon as we know the count is >= 2, since all our
 * invariants collapse into "zero / one / many".
 */
function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let from = 0;
  while (true) {
    const idx = haystack.indexOf(needle, from);
    if (idx < 0) break;
    count++;
    if (count >= 2) return count;
    from = idx + needle.length;
  }
  return count;
}

/**
 * Find all line numbers (1-indexed) where `needle` starts inside
 * `haystack`. Capped at `max` hits so the function can't burn time
 * on pathological inputs.
 */
function findMatchLines(
  haystack: string,
  needle: string,
  max: number,
): number[] {
  const lines: number[] = [];
  if (!needle) return lines;
  let from = 0;
  let currentLine = 1;
  let lastScanned = 0;
  while (lines.length < max) {
    const idx = haystack.indexOf(needle, from);
    if (idx < 0) break;
    // Count newlines between lastScanned and idx to update currentLine.
    for (let i = lastScanned; i < idx; i++) {
      if (haystack.charCodeAt(i) === 10) currentLine++;
    }
    lastScanned = idx;
    lines.push(currentLine);
    from = idx + needle.length;
  }
  return lines;
}

/**
 * Apply a find/replace patch to a program under strict invariants.
 *
 * Returns either an ApplyPatchSuccess with the new program or an
 * ApplyPatchFailure with a specific ValidationIssue. The result is
 * always one of those two shapes — the caller never needs to handle
 * a surprise third case.
 */
export function applyPatch(
  currentProgram: string,
  find: string,
  replace: string,
): ApplyPatchResult {
  const safeFind = typeof find === "string" ? find : "";
  const safeReplace = typeof replace === "string" ? replace : "";

  // Invariant 1: find must be non-empty.
  if (safeFind.length === 0) {
    return {
      ok: false,
      issue: {
        code: "patch.find_missing",
        message:
          "Your `find` argument was empty. Copy exact text from the " +
          "Current program block to identify what should be replaced.",
      },
    };
  }

  // Invariant 3: find must be at least MIN_FIND_CHARS.
  if (safeFind.length < MIN_FIND_CHARS) {
    return {
      ok: false,
      issue: {
        code: "patch.find_too_short",
        message:
          "Your `find` text is too short (only " +
          safeFind.length +
          " chars). Use at least " +
          MIN_FIND_CHARS +
          " characters — typically a full statement or a distinctive " +
          "object-literal fragment that appears only once in the program.",
      },
    };
  }

  // Invariant 4: find must be at most MAX_FIND_CHARS.
  if (safeFind.length > MAX_FIND_CHARS) {
    return {
      ok: false,
      issue: {
        code: "patch.find_too_long",
        message:
          "Your `find` text is too long (" +
          safeFind.length +
          " chars). For large changes, use write_mini_app with the " +
          "full updated program instead of patch_mini_app.",
      },
    };
  }

  // Invariant 2: find must not be the whole program.
  if (safeFind.trim() === currentProgram.trim()) {
    return {
      ok: false,
      issue: {
        code: "patch.too_large",
        message:
          "Your `find` is the entire current program — that's a " +
          "rewrite, not a patch. Use write_mini_app instead.",
      },
    };
  }

  // Invariant 6: find must differ from replace.
  if (safeFind === safeReplace) {
    return {
      ok: false,
      issue: {
        code: "patch.noop",
        message:
          "Your `find` and `replace` were identical — this patch would " +
          "make no changes. Make a concrete change or call write_mini_app " +
          "if no change is actually needed.",
      },
    };
  }

  // Invariant 5: find must appear exactly once.
  const count = countOccurrences(currentProgram, safeFind);
  if (count === 0) {
    return {
      ok: false,
      issue: {
        code: "patch.find_missing",
        message:
          "Your `find` text was not found in the current program. Copy " +
          "it exactly from the Current program block above (whitespace-" +
          "sensitive). If the change needs to touch many places, switch " +
          "to write_mini_app.",
      },
    };
  }
  if (count > 1) {
    const lines = findMatchLines(currentProgram, safeFind, 5);
    const linesStr = lines.length > 0 ? lines.join(", ") : "multiple places";
    return {
      ok: false,
      issue: {
        code: "patch.find_ambiguous",
        message:
          "Your `find` text appears multiple times in the current " +
          "program (around lines " +
          linesStr +
          "). Make it longer — include more surrounding lines — so it " +
          "matches exactly ONE location. Or switch to write_mini_app.",
      },
    };
  }

  // Invariant 7: replace must not be much larger than find.
  if (safeReplace.length > safeFind.length * MAX_REPLACE_MULTIPLIER) {
    return {
      ok: false,
      issue: {
        code: "patch.too_large",
        message:
          "Your `replace` text is much larger than `find` (" +
          safeReplace.length +
          " vs " +
          safeFind.length +
          " chars). For large changes, use write_mini_app with the full " +
          "updated program instead of patch_mini_app.",
      },
    };
  }

  // Apply the patch.
  const patched = currentProgram.replace(safeFind, safeReplace);

  // Invariant 8: program size cap.
  if (patched.length > MAX_PROGRAM_CHARS) {
    return {
      ok: false,
      issue: {
        code: "patch.program_too_big",
        message:
          "After applying the patch the program would be " +
          patched.length +
          " chars, over the " +
          MAX_PROGRAM_CHARS +
          "-char limit. Shrink the replacement or switch to write_mini_app.",
      },
    };
  }

  // Figure out the match line for the success payload.
  const [matchLine] = findMatchLines(currentProgram, safeFind, 1);

  return {
    ok: true,
    program: patched,
    matchLine: matchLine ?? 1,
  };
}
