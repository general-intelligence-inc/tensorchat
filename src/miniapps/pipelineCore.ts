/**
 * Pure pipeline core — the validator + write orchestration, with ALL
 * I/O abstracted behind an injected `PipelineDeps` interface. This
 * module has ZERO react-native imports, which means:
 *
 *   - It can be imported and exercised end-to-end in Node (via tsx)
 *     during local iteration without loading RNFS / AsyncStorage
 *   - Unit tests stub the three deps (writeApp, getAppIdForChat,
 *     appendMemoryNotes) with in-memory implementations
 *   - The tool pipeline module that wraps this one (toolPipeline.ts)
 *     just provides the default deps from production storage
 *
 * Why split this out: the production `toolPipeline.ts` imports from
 * `./storage`, which imports `react-native-fs`, which is Flow-typed
 * and unparseable by Node. A local test harness can't go through
 * that module. This pure-core file gives us the test seam.
 */

import type {
  MiniApp,
  MiniAppIdentity,
  WriteMiniAppInput,
} from "./types";
import {
  cleanProgramField,
  runStaticChecks,
} from "./validator/staticChecks";
import { smokeTestAsIssue } from "./validator/smokeTest";
import type {
  ExecutionTrace,
  SmokeResult,
  ValidationIssue,
} from "./validator/types";

/**
 * Pluggable I/O seams. Production uses defaults from toolPipeline.ts;
 * tests inject in-memory stubs.
 */
export interface PipelineDeps {
  writeApp: (input: WriteMiniAppInput) => Promise<MiniApp>;
  getAppIdForChat: (chatId: string) => Promise<string | null>;
  appendMemoryNotes: (chatId: string, notes: string[]) => Promise<void>;
}

export interface PipelineInput {
  chatId: string;
  /** The program as the model emitted it (may still have code fences). */
  rawProgram: string;
  /** Identity to use if this chat has no existing app on disk. */
  identity: MiniAppIdentity;
  /** Optional memory notes to append on success. */
  notes?: string[];
  /** Skip smoke test (for tests / offline benchmarks). */
  skipSmokeTest?: boolean;
}

export type PipelineOutcome =
  | {
      kind: "ok";
      app: MiniApp;
      executionTrace: ExecutionTrace | null;
      writtenProgram: string;
      warnings: ValidationIssue[];
    }
  | {
      kind: "error";
      issue: ValidationIssue;
    };

/**
 * The 8-step pipeline. Fully pure modulo the injected deps.
 */
export async function runPipelineWithDeps(
  input: PipelineInput,
  deps: PipelineDeps,
): Promise<PipelineOutcome> {
  // Diagnostic: log the raw arg we got from the agent.
  const rawPreview =
    input.rawProgram.length > 200
      ? input.rawProgram.slice(0, 200) + "…"
      : input.rawProgram;
  console.log(
    "[TensorChat] pipeline: raw program arg",
    JSON.stringify({
      length: input.rawProgram.length,
      preview: rawPreview,
    }),
  );

  // Step 0a: the model sent no `program` arg at all.
  if (input.rawProgram.length === 0) {
    return {
      kind: "error",
      issue: {
        code: "args.missing_program",
        message:
          "The tool call had no `program` argument. Call write_mini_app " +
          "again with a complete JavaScript program in the `program` field, " +
          "ending in tc.mount(renderFn).",
      },
    };
  }

  // Step 1: clean the raw program.
  const program = cleanProgramField(input.rawProgram);

  if (input.rawProgram !== program) {
    console.log("[TensorChat] pipeline: cleaned program field", {
      before: input.rawProgram.length,
      after: program.length,
    });
  }

  // Step 1a: cleanup stripped everything (fences/labels/whitespace only).
  if (program.length === 0 && input.rawProgram.length > 0) {
    return {
      kind: "error",
      issue: {
        code: "clean.empty",
        message:
          "Your `program` argument contained only markdown fences, " +
          "labels, or whitespace — no actual code. Emit the raw " +
          "JavaScript directly in the `program` field: start with " +
          "state initialization, end with tc.mount(function(){ return tc.column(...); }); — " +
          "no ``` fences, no [js] labels.",
      },
    };
  }

  // Step 2: static checks (short-circuits on first failure).
  const staticIssue = runStaticChecks(program);
  if (staticIssue) {
    return { kind: "error", issue: staticIssue };
  }

  // Step 3: smoke test (optional).
  let smokeResult: SmokeResult | null = null;
  if (!input.skipSmokeTest) {
    const smoke = await smokeTestAsIssue(program);
    if (!smoke.ok) {
      return { kind: "error", issue: smoke.issue };
    }
    smokeResult = smoke.result;
  }

  const trace: ExecutionTrace | null =
    smokeResult && smokeResult.kind === "ok" ? smokeResult.trace : null;

  // Step 4: disk write via injected deps.
  const existingId = await deps.getAppIdForChat(input.chatId);

  let app: MiniApp;
  try {
    if (existingId) {
      app = await deps.writeApp({
        kind: "iteration",
        id: existingId,
        chatId: input.chatId,
        program,
      });
    } else {
      app = await deps.writeApp({
        kind: "new",
        chatId: input.chatId,
        name: input.identity.name,
        emoji: input.identity.emoji,
        program,
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      kind: "error",
      issue: {
        code: "write.disk_error",
        message: "Failed to write mini app to disk: " + msg,
      },
    };
  }

  // Step 5: persist memory notes. Best-effort.
  if (Array.isArray(input.notes) && input.notes.length > 0) {
    try {
      const textNotes = input.notes.filter(
        (n): n is string => typeof n === "string",
      );
      if (textNotes.length > 0) {
        await deps.appendMemoryNotes(input.chatId, textNotes);
      }
    } catch (err) {
      console.warn("[TensorChat] appendMemoryNotes failed:", err);
    }
  }

  return {
    kind: "ok",
    app,
    executionTrace: trace,
    writtenProgram: program,
    warnings: [],
  };
}
