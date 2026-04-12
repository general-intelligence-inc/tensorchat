/**
 * Tool pipeline — production binding.
 *
 * The actual 8-step orchestration lives in `./pipelineCore.ts` as a
 * pure function that takes its I/O seams as an injected dep. This
 * wrapper exists to bind the default deps (react-native-fs +
 * AsyncStorage via `./storage` and `./memory`) so the tools can
 * continue to call a zero-arg `runPipeline(input)` exactly as before.
 *
 * The split lets a local Node-based test harness (see
 * `scripts/test-miniapp-local.ts`) import `./pipelineCore` directly
 * without pulling react-native-fs / AsyncStorage through the module
 * graph, which fails in Node because those packages ship Flow-typed
 * source.
 */

import { writeApp, getAppIdForChat } from "./storage";
import { appendMemoryNotes } from "./memory";
import {
  runPipelineWithDeps,
  type PipelineDeps,
  type PipelineInput,
  type PipelineOutcome,
} from "./pipelineCore";

export type { PipelineInput, PipelineOutcome } from "./pipelineCore";

/**
 * Default production deps, wired to the real storage + memory
 * modules. Tests don't use this — they call `runPipelineWithDeps`
 * directly with their own in-memory stubs.
 */
const PRODUCTION_DEPS: PipelineDeps = {
  writeApp,
  getAppIdForChat,
  // Wrap appendMemoryNotes to match the deps type (returns void).
  // The real fn returns MiniAppMemory but the pipeline doesn't
  // consume the return value.
  appendMemoryNotes: async (chatId: string, notes: string[]) => {
    await appendMemoryNotes(chatId, notes);
  },
};

/**
 * Convenience wrapper for production callers. Equivalent to
 * `runPipelineWithDeps(input, PRODUCTION_DEPS)`.
 */
export async function runPipeline(
  input: PipelineInput,
): Promise<PipelineOutcome> {
  return runPipelineWithDeps(input, PRODUCTION_DEPS);
}
