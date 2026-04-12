import {
  MINIAPP_MAX_AUTO_RETRIES,
  MINIAPP_VERIFY_WINDOW_MS,
  type RuntimeError,
  type VerificationState,
} from "./types";

/**
 * Tracks the "did the app we just wrote work?" window after each successful
 * write_mini_app call. Runtime JS errors occurring inside this window are
 * fed back to the Agent as a new user-scope turn ("the app threw X, fix it"),
 * up to MINIAPP_MAX_AUTO_RETRIES attempts per original user message.
 *
 * Errors outside the window are ignored — they are assumed to be user
 * interactions hitting a bug, which the user should ask about in their own
 * words rather than having the LLM silently rewrite the app under them.
 */
export class MiniAppVerificationTracker {
  // chatId -> VerificationState
  private states = new Map<string, VerificationState>();

  /**
   * Called after the write_mini_app tool successfully writes a new version.
   * Starts a fresh verification window.
   */
  startVerification(params: {
    chatId: string;
    appId: string;
    version: number;
    attemptsUsed: number;
  }): void {
    const now = Date.now();
    this.states.set(params.chatId, {
      chatId: params.chatId,
      appId: params.appId,
      version: params.version,
      startedAt: now,
      deadlineAt: now + MINIAPP_VERIFY_WINDOW_MS,
      attemptsUsed: params.attemptsUsed,
    });
  }

  /**
   * Reset verification state for a chat without classifying the most recent
   * run — used when the user sends a new message, which supersedes any
   * pending verification.
   */
  reset(chatId: string): void {
    this.states.delete(chatId);
  }

  /**
   * Look up the active verification state for a chat, or null if none.
   */
  get(chatId: string): VerificationState | null {
    return this.states.get(chatId) ?? null;
  }

  /**
   * Called by the WebView runtime-error bridge. Returns a classification of
   * what should happen next:
   *
   *  - "retry"  — the error happened inside the verification window AND
   *               we still have attempts left. Caller should synthesize a
   *               retry turn and call the Agent again.
   *  - "give_up" — error in window but attempts exhausted. Show a banner
   *               on the card, no auto-retry.
   *  - "ignore" — error happened outside the window, or for a different
   *               version of the app than the one under verification
   *               (e.g. a stale remount after a manual reload). Do nothing.
   */
  classifyRuntimeError(params: {
    chatId: string;
    appId: string;
    version: number;
    error: RuntimeError;
  }): {
    action: "retry" | "give_up" | "ignore";
    attemptsUsed: number;
    message: string;
  } {
    const state = this.states.get(params.chatId);
    if (!state) {
      return {
        action: "ignore",
        attemptsUsed: 0,
        message: "",
      };
    }

    // A runtime error for a DIFFERENT version than the one we're verifying
    // is stale (e.g. the user manually reloaded the old card). Ignore it.
    if (state.appId !== params.appId || state.version !== params.version) {
      return {
        action: "ignore",
        attemptsUsed: state.attemptsUsed,
        message: "",
      };
    }

    // Window expired?
    if (Date.now() > state.deadlineAt) {
      this.states.delete(params.chatId);
      return {
        action: "ignore",
        attemptsUsed: state.attemptsUsed,
        message: "",
      };
    }

    // Error in window. Clear the state — either we retry (and a new
    // startVerification will be called on the next successful write) or
    // we give up.
    this.states.delete(params.chatId);

    const retryPrompt = formatRetryPrompt(params.error);

    if (state.attemptsUsed >= MINIAPP_MAX_AUTO_RETRIES) {
      return {
        action: "give_up",
        attemptsUsed: state.attemptsUsed,
        message: retryPrompt,
      };
    }

    return {
      action: "retry",
      attemptsUsed: state.attemptsUsed + 1,
      message: retryPrompt,
    };
  }

  /**
   * Called when the verification window should time out "quietly" — the
   * app is considered verified and the state cleared.
   */
  expireIfElapsed(chatId: string): boolean {
    const state = this.states.get(chatId);
    if (!state) return false;
    if (Date.now() <= state.deadlineAt) return false;
    this.states.delete(chatId);
    return true;
  }

  /**
   * Clear all state — used when switching away from the chat / mode.
   */
  clear(): void {
    this.states.clear();
  }
}

function formatRetryPrompt(error: RuntimeError): string {
  const location = formatErrorLocation(error);
  return [
    "The mini-app you just wrote threw a runtime error:",
    "",
    `  ${error.message}${location ? " (" + location + ")" : ""}`,
    error.stack ? "\nStack:\n" + error.stack : "",
    "",
    "Analyze the root cause in the code you just emitted, then call write_mini_app again with the COMPLETE corrected app. Do not describe a diff — emit the full updated html, css, and js.",
  ]
    .filter((line) => line !== null && line !== undefined)
    .join("\n");
}

function formatErrorLocation(error: RuntimeError): string {
  const parts: string[] = [];
  if (error.source) parts.push(error.source);
  if (typeof error.line === "number") {
    parts.push(`line ${error.line}${typeof error.col === "number" ? ":" + error.col : ""}`);
  }
  return parts.join(" ");
}
