/**
 * Canonical catalog of llama.rn error messages and their semantic
 * classification.
 *
 * The harness needs to decide how to handle an error from
 * llama.rn (context busy → long cooldown, context overflow → bump
 * compaction immediately, hard failure → bail). The previous approach
 * was ad-hoc string `includes()` checks scattered inside
 * `classifyError`; every new llama.rn error message we encountered
 * required a manual pattern update and often silently degraded into
 * `"unknown"`.
 *
 * This module centralizes the known patterns in one place. Adding a
 * new variant is a one-line change, and the harness gets a typed,
 * sealed enum instead of a string soup.
 *
 * The patterns are ordered from most-specific to most-generic: the
 * first match wins. This lets us keep broad fallbacks (like
 * "released" → hard-failure) without them shadowing more specific
 * ones (like "n_ctx exceeded" → context-overflow).
 */

/**
 * The sealed taxonomy of llama.rn error kinds that matter to the harness.
 * Anything that doesn't match returns null, and the caller falls back
 * to the legacy ErrorClass union.
 */
export type LlamaErrorKind =
  | "context-busy"
  | "context-overflow"
  | "model-released"
  | "no-model-loaded"
  | "stop-requested"
  | "native-crash";

interface CatalogEntry {
  /** Case-insensitive regex against the error message text. */
  pattern: RegExp;
  /** Semantic classification for the harness. */
  kind: LlamaErrorKind;
  /** Short human-readable description used in retry reasons. */
  humanReason: string;
}

const CATALOG: CatalogEntry[] = [
  // Context busy — the native thread hasn't released the previous
  // completion yet. Most common cause: back-to-back generations.
  {
    pattern: /context\s+is\s+busy/i,
    kind: "context-busy",
    humanReason: "Releasing model context…",
  },

  // Context overflow — prompt + output would exceed n_ctx.
  {
    pattern: /n_ctx|context\s+(is\s+)?full|token.*exceed|prompt\s+too\s+large|exceeds\s+(the\s+)?context/i,
    kind: "context-overflow",
    humanReason: "Shrinking the prompt…",
  },

  // Stop was explicitly requested (via stopGeneration).
  {
    pattern: /generation\s+stopped|user\s+(abort|cancel)|stop_requested/i,
    kind: "stop-requested",
    humanReason: "Stopped by user.",
  },

  // The model was released (unloaded) while a generation was in flight.
  {
    pattern: /released|model\s+unloaded|context\s+(was\s+)?released/i,
    kind: "model-released",
    humanReason: "Model was unloaded.",
  },

  // No model has been loaded yet.
  {
    pattern: /no\s+model\s+(is\s+)?loaded|model\s+not\s+loaded/i,
    kind: "no-model-loaded",
    humanReason: "No model loaded.",
  },

  // Native crashes / fatal errors.
  {
    pattern: /native\s+(crash|error)|segmentation|abort/i,
    kind: "native-crash",
    humanReason: "Native runtime error.",
  },
];

/**
 * Classify an error message against the catalog. Returns the first
 * matching entry or null if nothing matches.
 *
 * The input can be a raw string, an Error object, or any value — we
 * coerce to string defensively. Non-Error values (like thrown
 * primitives or custom shapes) are stringified via String().
 */
export function classifyLlamaError(err: unknown): {
  kind: LlamaErrorKind;
  humanReason: string;
} | null {
  let msg = "";
  if (err == null) return null;
  if (err instanceof Error) {
    msg = err.message;
  } else if (typeof err === "string") {
    msg = err;
  } else if (typeof err === "object") {
    // Try common properties (.message, .error, .reason).
    const anyErr = err as Record<string, unknown>;
    if (typeof anyErr.message === "string") msg = anyErr.message;
    else if (typeof anyErr.error === "string") msg = anyErr.error;
    else if (typeof anyErr.reason === "string") msg = anyErr.reason;
    else msg = String(err);
  } else {
    msg = String(err);
  }

  if (!msg) return null;

  for (const entry of CATALOG) {
    if (entry.pattern.test(msg)) {
      return { kind: entry.kind, humanReason: entry.humanReason };
    }
  }
  return null;
}

/**
 * Humanize any error class into a short status-strip reason. Used by
 * the harness to surface "why are we retrying?" in the UI without
 * exposing internal error codes.
 *
 * Accepts both the legacy ErrorClass strings and the LlamaErrorKind
 * values from `classifyLlamaError`. New ValidationCode groups from
 * `src/miniapps/validator/types.ts` map through their prefix (e.g.
 * `smoke.*` → "Fixing a runtime bug").
 */
export function humanizeRetryReason(errorKind: string): string {
  // Direct matches from the llama catalog.
  switch (errorKind) {
    case "context-busy":
      return "Releasing model context…";
    case "context-overflow":
      return "Shrinking the prompt…";
    case "timeout":
      return "Model was slow, trying again…";
    case "tool-validation":
      return "Fixing a syntax issue…";
    case "model-silent":
      return "Nudging the model…";
    case "hard-failure":
      return "Fatal error.";
    case "duplicate_attempt":
      return "Model repeated itself, nudging…";
    case "unknown":
      return "Retrying…";
  }

  // ValidationCode prefix-based matching for the new codes from v2.
  if (errorKind.startsWith("smoke.no_mount") || errorKind === "static.no_mount") {
    return "Adding missing mount call…";
  }
  if (errorKind.startsWith("smoke.render")) {
    return "Fixing a runtime bug…";
  }
  if (errorKind.startsWith("smoke.")) {
    return "Fixing a runtime bug…";
  }
  if (errorKind.startsWith("parse.") || errorKind.startsWith("static.html")) {
    return "Fixing a syntax issue…";
  }
  if (errorKind.startsWith("static.")) {
    return "Fixing program structure…";
  }
  if (errorKind.startsWith("schema.")) {
    return "Fixing a component prop…";
  }
  if (errorKind.startsWith("patch.find_missing")) {
    return "Patch missed, retrying…";
  }
  if (errorKind.startsWith("patch.find_ambiguous")) {
    return "Patch ambiguous, retrying…";
  }
  if (errorKind.startsWith("patch.")) {
    return "Fixing the patch…";
  }
  if (errorKind.startsWith("write.")) {
    return "Writing to disk…";
  }

  return "Retrying…";
}
