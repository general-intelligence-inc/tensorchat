import type { Tool } from "../types";
import { MAX_NOTES_PER_WRITE } from "../../miniapps/memory";
import { readApp, getAppIdForChat } from "../../miniapps/storage";
import type { MiniApp, MiniAppIdentity } from "../../miniapps/types";
import { runPipeline } from "../../miniapps/toolPipeline";
import { applyPatch } from "../../miniapps/validator/applyPatch";

export interface PatchMiniAppContext {
  chatId: string;
  /**
   * Identity — reused from the WriteMiniAppContext. Unused on patch
   * runs in practice (since a chat MUST already have an app for a
   * patch to make sense), but wired through for symmetry.
   */
  identity: MiniAppIdentity;
  /** Called after a successful write (same semantics as writeMiniApp). */
  onWritten: (app: MiniApp) => void | Promise<void>;
}

/**
 * Factory that produces a `patch_mini_app` Tool bound to a specific chat.
 *
 * This tool is the small-model-friendly counterpart to `write_mini_app`.
 * Instead of emitting a full program on every tiny edit, the model emits
 * a `find`/`replace` pair that targets a specific section of the current
 * program. The pure `applyPatch` function enforces strict invariants
 * (exact single match, length bounds, etc.), and then the result goes
 * through the SAME pipeline as a full write — so the same smoke test
 * and schema validator catch any regression the patch might have
 * introduced.
 *
 * On the first user turn (no app exists yet) this tool silently
 * refuses with a `patch.find_missing`-coded diagnostic and tells the
 * model to use write_mini_app.
 */
export function createPatchMiniAppTool(ctx: PatchMiniAppContext): Tool {
  return {
    definition: {
      name: "patch_mini_app",
      description:
        "Apply a targeted find/replace edit to the current mini-app. Use " +
        "this for SMALL changes like 'make the button blue' or 'rename the " +
        "header' or 'add a reset button'. The `find` text must appear EXACTLY " +
        "ONCE in the current program (whitespace-sensitive) — copy it " +
        "verbatim from the Current program block in the system prompt. " +
        "For full rewrites or changes touching many places, use " +
        "write_mini_app instead.",
      parameters: {
        type: "object",
        properties: {
          find: {
            type: "string",
            description:
              "Exact text to locate in the current program. Must match " +
              "EXACTLY ONCE (whitespace-sensitive). Copy it verbatim from " +
              "the `Current program` block in the system prompt. Keep it " +
              "short but unique — typically one statement or one object " +
              "literal, 2-8 lines.",
          },
          replace: {
            type: "string",
            description:
              "New text that will replace `find`. Must be valid JavaScript " +
              "in context. Do NOT include backticks or markdown fences.",
          },
          notes: {
            type: "array",
            description: `Optional. Up to ${MAX_NOTES_PER_WRITE} short one-liners (<240 chars each) about decisions, preferences, or facts to remember across turns.`,
            items: { type: "string" },
          },
        },
        required: ["find", "replace"],
      },
    },

    async execute(args) {
      const find = typeof args.find === "string" ? args.find : "";
      const replace = typeof args.replace === "string" ? args.replace : "";
      const notes = Array.isArray(args.notes)
        ? args.notes.filter((n): n is string => typeof n === "string")
        : undefined;

      // The chat MUST already have an app for a patch to be meaningful.
      const existingId = await getAppIdForChat(ctx.chatId);
      if (!existingId) {
        return {
          content:
            "There's no existing mini-app in this chat to patch. Use " +
            "write_mini_app to create the first version instead.",
          isError: true,
        };
      }

      const existing = await readApp(existingId);
      if (!existing) {
        return {
          content:
            "The current mini-app could not be loaded. Use write_mini_app " +
            "to create a fresh version.",
          isError: true,
        };
      }

      // Apply the patch under strict invariants. Every failure here is
      // a specific ValidationCode that the retry prompt composer maps
      // to a crisp diagnostic.
      const patchResult = applyPatch(existing.program, find, replace);
      if (!patchResult.ok) {
        return {
          content: patchResult.issue.message,
          isError: true,
        };
      }

      // Run the patched program through the FULL validation pipeline.
      // Same smoke test, same schema validator, same atomic write.
      // The pipeline will pick "iteration" automatically because
      // getAppIdForChat returns the existing id.
      const outcome = await runPipeline({
        chatId: ctx.chatId,
        rawProgram: patchResult.program,
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
        // Callback failures shouldn't roll back the disk write.
      }

      return {
        content: `Patched "${app.name}" ${app.emoji} (version ${app.version}). The app is now running in the chat preview.`,
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
