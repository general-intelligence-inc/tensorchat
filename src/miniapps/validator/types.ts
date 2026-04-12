/**
 * Shared types for the mini-app validation pipeline.
 *
 * Every tool call funnels through a sequence of validators (arg validation
 * → cleanProgram → parseJs → staticChecks → smokeTest → schemaValidate →
 * writeToDisk). Each step either returns ok with a `ValidationReport` or
 * fails with a `ValidationIssue[]`. The harness turns those issues into
 * model-actionable retry prompts via `errorFeedback.renderRetryAppendix`.
 *
 * Keeping these types in a dedicated module (instead of colocated with
 * each validator) makes it possible for both the harness and the tool
 * layer to import them without pulling in runtime-heavy bits like the
 * smoke-test or the JS parser.
 */

/**
 * Canonical codes for pipeline failures. Each code corresponds to a
 * specific retry-prompt template in `errorFeedback.ts` and a specific
 * `errorKind` mapping in the harness's cooldown table.
 *
 * Naming convention:
 *   - `args.*`        — raw tool argument validation (pre-clean)
 *   - `clean.*`       — post-cleanup validation (fences stripped)
 *   - `parse.*`       — JS syntax errors
 *   - `static.*`      — regex/static-analysis failures
 *   - `smoke.*`       — failures during the headless pre-flight eval
 *   - `schema.*`      — component prop-schema violations (from the tree)
 *   - `patch.*`       — patch-tool-specific failures (find/replace rules)
 *   - `write.*`       — disk-write failures
 */
export type ValidationCode =
  | "args.missing_program"
  | "args.program_empty"
  | "args.missing_find_or_replace"
  | "args.program_not_string"
  | "clean.empty"
  | "parse.syntax_error"
  | "static.no_mount"
  | "static.html_tags"
  | "static.conditional_mount"
  | "static.program_too_big"
  | "smoke.parse_error"
  | "smoke.top_level_threw"
  | "smoke.no_mount"
  | "smoke.mount_not_function"
  | "smoke.render_threw"
  | "smoke.render_returned_nothing"
  | "smoke.render_invalid_tree"
  | "smoke.timeout"
  | "schema.unknown_component"
  | "schema.unknown_prop"
  | "schema.wrong_prop_type"
  | "schema.missing_required_prop"
  | "schema.children_not_allowed"
  | "schema.invalid_enum_value"
  | "patch.find_missing"
  | "patch.find_ambiguous"
  | "patch.find_too_short"
  | "patch.find_too_long"
  | "patch.noop"
  | "patch.too_large"
  | "patch.program_too_big"
  | "write.disk_error";

/**
 * A single validation failure. Carries everything the retry-prompt
 * composer needs to render an actionable diagnostic — a model-facing
 * message, an optional tree/code location, and optional suggestions
 * (e.g. "did you mean `primary`?").
 */
export interface ValidationIssue {
  /** Stable machine-readable code — drives cooldowns and retry prompts. */
  code: ValidationCode;
  /** Model-facing sentence describing the problem. */
  message: string;
  /** Optional source location inside the generated JS program. */
  location?: {
    line?: number;
    col?: number;
    /** Dot-path inside the descriptor tree, e.g. "root.column.children[2]". */
    treePath?: string;
  };
  /** Optional follow-up hints: "did you mean X?" / "valid values are [...]". */
  suggestions?: string[];
  /**
   * Optional extra context used by specific retry templates. Intentionally
   * loose — each code knows what keys it populates. Kept lean so the
   * retry prompt composer can read it without type-gymnastics.
   */
  details?: Record<string, unknown>;
}

/**
 * Successful pipeline run. Carries any diagnostics the pipeline gathered
 * along the way (e.g. a write succeeded but `write.should_have_patched`
 * was logged as a soft warning).
 */
export interface ValidationReport {
  /** Soft warnings that didn't block the write. */
  warnings: ValidationIssue[];
  /** Cumulative bookkeeping filled in by individual steps. */
  meta: {
    cleanedProgram?: string;
    originalProgramChars?: number;
    cleanedProgramChars?: number;
    staticChecksPassed?: boolean;
    smokeDurationMs?: number;
    /** Filled in by schemaValidate from the captured descriptor tree. */
    componentTypesUsed?: string[];
  };
}

/**
 * Execution trace captured by the smoke test. Feeds into the retry
 * prompt so the model sees CONCRETE state ("you read state.count but
 * never set it") instead of just "runtime error".
 *
 * Only populated for smoke results that got at least as far as
 * invoking the render function; earlier failures return partial
 * traces or no trace at all.
 */
export interface ExecutionTrace {
  /** Whether tc.mount was called during the program's top-level eval. */
  mountCalled: boolean;
  /** Number of times the captured render fn was invoked (currently always 0 or 1). */
  renderInvocations: number;
  /** State keys assigned during top-level eval, before the render fn ran. */
  stateKeysWritten: string[];
  /** State keys the render fn read while producing the tree. */
  stateKeysRead: string[];
  /** Keys passed to tc.save() during top-level eval. */
  topLevelSaves: Array<{ key: string }>;
  /** The root component type of the tree (null if render didn't return a descriptor). */
  rootTreeType: string | null;
  /** Unique component types visited while traversing the tree. */
  visitedComponentTypes: string[];
  /** First caught error (top-level or render), if any. */
  firstError?: { message: string; stack?: string };
}

/**
 * Tagged union returned by `smokeTest(program)`. Every kind has a
 * deterministic mapping to a `ValidationCode` inside the pipeline.
 */
export type SmokeResult =
  | { kind: "ok"; trace: ExecutionTrace; durationMs: number; tree: unknown }
  | {
      kind: "parse_error";
      message: string;
      line?: number;
      col?: number;
      durationMs: number;
    }
  | {
      kind: "top_level_threw";
      message: string;
      stack?: string;
      durationMs: number;
    }
  | {
      kind: "no_mount";
      message: string;
      trace: ExecutionTrace;
      durationMs: number;
    }
  | {
      kind: "mount_not_function";
      message: string;
      durationMs: number;
    }
  | {
      kind: "render_threw";
      message: string;
      stack?: string;
      trace: ExecutionTrace;
      durationMs: number;
    }
  | {
      kind: "render_returned_nothing";
      message: string;
      trace: ExecutionTrace;
      durationMs: number;
    }
  | {
      kind: "render_invalid_tree";
      message: string;
      treePath: string;
      trace: ExecutionTrace;
      durationMs: number;
    }
  | { kind: "timeout"; afterMs: number };

/**
 * Helper: build an empty report. Used by every pipeline step as the
 * starting point before adding warnings / meta.
 */
export function emptyReport(): ValidationReport {
  return { warnings: [], meta: {} };
}

/**
 * Helper: make a single-issue failure for pipeline steps that compute
 * and return a terminal issue. Shorthand for `{ ok: false, issues: [...] }`
 * wrappers that would otherwise repeat at every call site.
 */
export function issueList(...issues: ValidationIssue[]): ValidationIssue[] {
  return issues;
}
