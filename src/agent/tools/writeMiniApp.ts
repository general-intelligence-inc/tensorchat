import type { Tool } from "../types";
import { MAX_NOTES_PER_WRITE } from "../../miniapps/memory";
import type { MiniApp, MiniAppIdentity } from "../../miniapps/types";
import { runPipeline } from "../../miniapps/toolPipeline";

export interface WriteMiniAppContext {
  chatId: string;
  /**
   * Identity for new-app creation. Derived deterministically from the
   * user's first prompt by `deriveAppIdentity` in `src/miniapps/identity.ts`.
   * Only used when this chat doesn't yet have an app on disk; on iteration
   * the existing identity is preserved verbatim.
   */
  identity: MiniAppIdentity;
  /**
   * Called after a successful write so callers (ChatScreen) can update
   * their in-memory app cache and start the verification window.
   */
  onWritten: (app: MiniApp) => void | Promise<void>;
}

/**
 * Factory that produces a `write_mini_app` Tool bound to a specific chat.
 *
 * Single-field schema: the LLM emits ONE `program` string that calls
 * into the `tc` component runtime (see `src/miniapps/runtime/tc.ts`).
 * The tool is a thin wrapper around the shared `runPipeline` — all
 * validation (clean, static checks, smoke test, schema) and the disk
 * write happen inside the pipeline. This tool just converts the
 * outcome back to a `ToolResult` shape the Agent understands.
 *
 * The `patch_mini_app` sibling tool (see `patchMiniApp.ts`) applies a
 * find/replace against the current program and then delegates to the
 * SAME pipeline, so both code paths share the exact same error codes,
 * retry templates, and atomic write semantics.
 */
export function createWriteMiniAppTool(ctx: WriteMiniAppContext): Tool {
  return {
    definition: {
      name: "write_mini_app",
      description:
        "Create or replace the mini-app for this chat. Emit a single " +
        "JavaScript program that composes `tc.*` primitives and calls " +
        "`tc.mount(render)` at the end. Use this tool for the FIRST build, " +
        "for full rewrites the user explicitly requested, or for changes " +
        "that affect more than about 40% of the current program. For " +
        "smaller targeted edits, use `patch_mini_app` instead. The app's " +
        "name and emoji are managed automatically — do not include them.",
      parameters: {
        type: "object",
        properties: {
          program: {
            type: "string",
            description:
              "Complete JavaScript program using the tc component runtime. " +
              "Must call tc.mount(renderFn) at the end. No HTML, no CSS, " +
              "no tags — the runtime handles rendering.",
          },
          notes: {
            type: "array",
            description: `Optional. Up to ${MAX_NOTES_PER_WRITE} short one-liners (<240 chars each) about key decisions, user preferences, or current-app facts to remember across turns.`,
            items: { type: "string" },
          },
        },
        required: ["program"],
      },
    },

    async execute(args) {
      // Coerce defensively — the model sometimes emits numbers or nulls
      // for string fields when the grammar is malformed.
      const rawProgram = typeof args.program === "string" ? args.program : "";
      const notes = Array.isArray(args.notes)
        ? args.notes.filter((n): n is string => typeof n === "string")
        : undefined;

      const outcome = await runPipeline({
        chatId: ctx.chatId,
        rawProgram,
        identity: ctx.identity,
        notes,
      });

      if (outcome.kind === "error") {
        return {
          content: outcome.issue.message,
          isError: true,
        };
      }

      const app = outcome.app;

      try {
        await ctx.onWritten(app);
      } catch {
        // Callback failures shouldn't roll back the disk write — the
        // file is still valid. ChatScreen may just not refresh until
        // the next render.
      }

      return {
        content: `Saved "${app.name}" ${app.emoji} (version ${app.version}). The app is now running in the chat preview.`,
        metadata: {
          miniAppSnapshot: {
            appId: app.id,
            version: app.version,
            name: app.name,
            emoji: app.emoji,
          },
        },
      };
    },
  };
}
