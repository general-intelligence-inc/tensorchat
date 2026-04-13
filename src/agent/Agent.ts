import AsyncStorage from "@react-native-async-storage/async-storage";
import type { UseLlamaReturn } from "../hooks/useLlama";
import { agentGenerate } from "./llamaAdapter";
import type {
  AgentConfig,
  AgentEvent,
  AgentHooks,
  AgentResult,
  AgentSession,
  Tool,
  ToolResult,
  StructuredMessage,
  StructuredMessages,
} from "./types";

const DEFAULT_MAX_ITERATIONS = 3;
const SESSION_KEY_PREFIX = "@tensorchat/agent-sessions/";

const AGENT_TOOL_GUIDANCE =
  "You have access to tools. When a question requires current or factual " +
  "information you are uncertain about, use the available tools to find accurate answers.\n\n" +
  "After receiving tool results, analyze them carefully:\n" +
  "- If the results are sufficient, synthesize a clear answer.\n" +
  "- If the results are insufficient or unclear, you may call tools again with a refined query.\n" +
  "- Do not repeat the same query. Refine based on what you learned.\n\n" +
  "IMPORTANT: Never include URLs or links in your response. " +
  "Do not generate, cite, or reference any links — not even from tool results. " +
  "Present information in plain text only.";

const PROMPT_WEEKDAY_NAMES = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];
const PROMPT_MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function formatPromptDateTime(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const weekdayName = PROMPT_WEEKDAY_NAMES[date.getDay()];
  const monthName = PROMPT_MONTH_NAMES[date.getMonth()];
  const dayOfMonth = date.getDate();
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  const timezoneOffsetMinutes = -date.getTimezoneOffset();
  const sign = timezoneOffsetMinutes >= 0 ? "+" : "-";
  const absoluteOffsetMinutes = Math.abs(timezoneOffsetMinutes);
  const offsetHours = String(Math.floor(absoluteOffsetMinutes / 60)).padStart(2, "0");
  const offsetMinutes = String(absoluteOffsetMinutes % 60).padStart(2, "0");
  const isoDate = `${year}-${month}-${day}`;

  return `${weekdayName}, ${monthName} ${dayOfMonth}, ${year} ${hours}:${minutes}:${seconds} GMT${sign}${offsetHours}:${offsetMinutes} (ISO ${isoDate})`;
}

/**
 * Truncate a tool result's content to stay within a token budget.
 * Keeps the first `maxChars` characters and appends a truncation notice
 * so the model knows the result was shortened.
 */
function truncateToolContent(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  return content.slice(0, maxChars) + "\n...[truncated]";
}

/**
 * Condense older tool result messages in history to free context space.
 * Keeps only a short summary of each tool result that isn't the most recent.
 */
function condenseHistory(history: StructuredMessages): StructuredMessages {
  // Find indices of all tool-result messages.
  const toolIndices: number[] = [];
  for (let i = 0; i < history.length; i++) {
    if (history[i].role === "tool") {
      toolIndices.push(i);
    }
  }

  // Nothing to condense if 0 or 1 tool result.
  if (toolIndices.length <= 1) return history;

  // Condense all tool results except the last one.
  const lastToolIdx = toolIndices[toolIndices.length - 1];
  return history.map((msg, idx) => {
    if (msg.role === "tool" && idx !== lastToolIdx && typeof msg.content === "string") {
      return { ...msg, content: truncateToolContent(msg.content, 200) };
    }
    return msg;
  });
}

/**
 * Sanitize tool calls before appending to history. Ensures each tool call
 * has valid JSON in its `arguments` field — models sometimes emit truncated
 * or malformed JSON that breaks `getFormattedChat` on the next iteration.
 */
function sanitizeToolCalls(
  toolCalls: Array<{ type: "function"; id?: string; function: { name: string; arguments: string } }>,
): Array<{ type: "function"; id?: string; function: { name: string; arguments: string } }> {
  return toolCalls.map((tc) => {
    let args = tc.function.arguments;
    try {
      // Validate — if it parses, it's fine.
      JSON.parse(args);
    } catch {
      // Try to fix common issues: truncated JSON, missing closing braces.
      const fixed = args.trim();
      const openBraces = (fixed.match(/\{/g) || []).length;
      const closeBraces = (fixed.match(/\}/g) || []).length;
      let patched = fixed + "}".repeat(Math.max(0, openBraces - closeBraces));

      try {
        JSON.parse(patched);
        args = patched;
      } catch {
        // Still broken — wrap the raw text as a query argument,
        // which is the most common tool call pattern.
        args = JSON.stringify({ query: fixed.replace(/[{}":]/g, "").trim() || "search" });
      }
    }
    return { ...tc, function: { ...tc.function, arguments: args } };
  });
}

function generateId(): string {
  return (
    "agent_" +
    Date.now().toString(36) +
    "_" +
    Math.random().toString(36).slice(2, 8)
  );
}

export class Agent {
  private llama: UseLlamaReturn;
  private config: AgentConfig;
  private tools: Map<string, Tool>;
  private history: StructuredMessages;
  private hooks: AgentHooks;
  private emitEvent: (event: AgentEvent) => void;
  private stopped: boolean;

  constructor(llama: UseLlamaReturn, config: AgentConfig) {
    this.llama = llama;
    this.config = config;
    this.tools = new Map();
    this.history = [];
    this.hooks = config.hooks ?? {};
    this.emitEvent = config.onEvent ?? (() => {});
    this.stopped = false;

    // Register initial tools from config.
    if (config.tools) {
      for (const tool of config.tools) {
        this.tools.set(tool.definition.name, tool);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Tool Management
  // ---------------------------------------------------------------------------

  registerTool(tool: Tool): void {
    this.tools.set(tool.definition.name, tool);
  }

  removeTool(name: string): void {
    this.tools.delete(name);
  }

  getTools(): Tool[] {
    return Array.from(this.tools.values());
  }

  // ---------------------------------------------------------------------------
  // Conversation Management
  // ---------------------------------------------------------------------------

  getHistory(): StructuredMessages {
    return [...this.history];
  }

  clearHistory(): void {
    this.history = [];
  }

  appendUserMessage(content: string): void {
    this.history.push({ role: "user", content });
  }

  // ---------------------------------------------------------------------------
  // Execution
  // ---------------------------------------------------------------------------

  async stop(): Promise<void> {
    this.stopped = true;
    await this.llama.stopGeneration();
  }

  /**
   * Run the ReAct loop: generate → check tool calls → execute → re-generate.
   *
   * Streams AgentEvents via the onEvent callback throughout execution.
   */
  async run(userMessage: string, images?: string[]): Promise<AgentResult> {
    this.stopped = false;
    const maxIterations = this.config.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    const allToolCalls: AgentResult["toolCalls"] = [];
    const toolsUsedSet = new Set<string>();

    // Ensure the conversation has a system prompt.
    if (this.history.length === 0 || this.history[0].role !== "system") {
      const systemPrompt = this.buildSystemPrompt();
      if (systemPrompt) {
        this.history.unshift({ role: "system", content: systemPrompt });
      }
    }

    // Append user message.
    const userContent = this.buildUserContent(userMessage, images);
    this.history.push({ role: "user", content: userContent });

    let finalText = "";
    let finalThinking: string | undefined;
    let iterations = 0;

    for (let i = 0; i < maxIterations; i++) {
      if (this.stopped) break;
      iterations = i + 1;

      // Fire iteration hooks / events.
      this.hooks.onIterationStart?.(i, this.history);
      this.emitEvent({ type: "iterationStart", iteration: i });

      // Condense older tool results to free context space for subsequent
      // iterations. Only the most recent tool result keeps its full content.
      const condensedHistory = condenseHistory(this.history);

      // On the first iteration with tools, suppress text/thinking streaming
      // to the UI. If the model doesn't call tools, we'll do a direct search
      // fallback and the user should only see the synthesis — not the model's
      // initial (likely unhelpful) response from parametric knowledge.
      // Callers that actively USE first-iteration streaming events (e.g. the
      // mini-app harness's phased progress indicator) can opt out via
      // `streamFirstIteration`.
      const suppressStreaming =
        i === 0 &&
        this.tools.size > 0 &&
        !this.config.streamFirstIteration;
      const iterationOnEvent = suppressStreaming
        ? (event: AgentEvent) => {
            // Only forward non-content events (iteration markers, errors).
            if (event.type !== "text" && event.type !== "thinking") {
              this.emitEvent(event);
            }
          }
        : this.emitEvent;

      // Generate a response.
      let genResult;
      try {
        genResult = await agentGenerate(this.llama, condensedHistory, {
          tools: this.tools.size > 0
            ? Array.from(this.tools.values()).map((t) => t.definition)
            : undefined,
          thinking: this.config.thinking,
          thinkingBudget: this.config.thinkingBudget,
          alwaysThinks: this.config.alwaysThinks,
          systemPromptTools: this.config.systemPromptTools,
          nativeReasoning: this.config.nativeReasoning,
          maxGenerationTokens: this.config.maxGenerationTokens,
          onEvent: iterationOnEvent,
        });
      } catch (genError) {
        // Context overflow or other generation failure — return what we have
        // rather than crashing.
        const errMsg = genError instanceof Error ? genError.message : String(genError);
        this.emitEvent({ type: "error", error: errMsg, recoverable: false });

        if (finalText) {
          // We have a previous response — return it.
          break;
        }

        // No previous text — try one last generation with minimal history.
        try {
          const minimalHistory = this.buildMinimalHistory();
          const fallbackResult = await agentGenerate(this.llama, minimalHistory, {
            thinking: this.config.thinking,
            thinkingBudget: this.config.thinkingBudget,
            alwaysThinks: this.config.alwaysThinks,
            nativeReasoning: this.config.nativeReasoning,
            maxGenerationTokens: this.config.maxGenerationTokens,
            onEvent: this.emitEvent,
          });
          finalText = fallbackResult.text;
          finalThinking = fallbackResult.thinking;
        } catch {
          finalText = "I encountered an error while processing your request. Please try again.";
        }
        break;
      }

      finalText = genResult.text;
      finalThinking = genResult.thinking;
      const hasToolCalls = genResult.toolCalls.length > 0;

      if (!hasToolCalls) {
        // First iteration and model didn't call any tools despite having them
        // available — the model may be too small to reliably generate tool
        // calls. Fall back to direct search: execute the first registered tool
        // with the user's message as the query, then re-generate with results.
        //
        // Artifact flows (mini-apps) disable this: the fallback makes no sense
        // when the tool's purpose is to emit code (the `query` arg doesn't
        // exist), and the back-to-back completion races llama.rn's context
        // cleanup — the exact cause of "Context is busy" cascades.
        if (
          i === 0 &&
          this.tools.size > 0 &&
          !this.config.disableDirectSearchFallback
        ) {
          const firstTool = this.tools.values().next().value;
          if (firstTool) {
            const directCallId = generateId();
            this.emitEvent({
              type: "toolCall",
              name: firstTool.definition.name,
              args: { query: userMessage },
              id: directCallId,
            });

            try {
              const directResult = await firstTool.execute({ query: userMessage });

              this.emitEvent({
                type: "toolResult",
                name: firstTool.definition.name,
                result: directResult,
                id: directCallId,
              });

              toolsUsedSet.add(firstTool.definition.name);
              allToolCalls.push({
                name: firstTool.definition.name,
                args: { query: userMessage },
                result: directResult,
              });

              // Build a clean prompt for synthesis — no tool-role messages,
              // just the search results injected as context in the user message.
              // This avoids confusing models that can't handle tool messages
              // without tool definitions.
              const synthesisMessages: StructuredMessages = [];
              const systemMsg = this.history.find((m) => m.role === "system");
              if (systemMsg) {
                synthesisMessages.push({
                  role: "system",
                  content: typeof systemMsg.content === "string"
                    ? systemMsg.content
                    : "You are a helpful AI assistant.",
                });
              }
              synthesisMessages.push({
                role: "user",
                content:
                  userMessage +
                  "\n\nHere are relevant web search results to help answer the question:\n\n" +
                  directResult.content,
              });

              const synthesisResult = await agentGenerate(this.llama, synthesisMessages, {
                // No tools — force the model to answer from context.
                thinking: this.config.thinking,
                thinkingBudget: this.config.thinkingBudget,
                alwaysThinks: this.config.alwaysThinks,
                nativeReasoning: this.config.nativeReasoning,
                maxGenerationTokens: this.config.maxGenerationTokens,
                onEvent: this.emitEvent,
              });

              finalText = synthesisResult.text;
              finalThinking = synthesisResult.thinking;
              iterations = 2;
              this.history.push({
                role: "assistant",
                content: synthesisResult.text,
                ...(synthesisResult.thinking ? { reasoning_content: synthesisResult.thinking } : {}),
              });
              break;
            } catch {
              // Direct search failed — fall through to use the original response.
            }
          }
        }

        // No tool calls — this is the final answer.
        // If we suppressed streaming on this iteration, emit the content now.
        if (suppressStreaming && genResult.text) {
          this.emitEvent({ type: "text", content: genResult.text });
        }
        this.history.push({
          role: "assistant",
          content: genResult.text,
          ...(genResult.thinking ? { reasoning_content: genResult.thinking } : {}),
        });
        this.hooks.onIterationEnd?.(i, false);
        this.emitEvent({ type: "iterationEnd", iteration: i, hasMoreToolCalls: false });
        break;
      }

      // Append assistant message with tool calls to history.
      // Sanitize tool call arguments to prevent malformed JSON from breaking
      // getFormattedChat on the next iteration.
      this.history.push({
        role: "assistant",
        content: genResult.rawOutput,
        ...(genResult.thinking ? { reasoning_content: genResult.thinking } : {}),
        tool_calls: sanitizeToolCalls(genResult.toolCalls),
      });

      // Execute each tool call.
      for (const toolCall of genResult.toolCalls) {
        if (this.stopped) break;

        const toolName = toolCall.function.name;
        const tool = this.tools.get(toolName);
        let args: Record<string, unknown> = {};

        try {
          args = JSON.parse(toolCall.function.arguments);
        } catch {
          this.emitEvent({
            type: "error",
            error: `Invalid tool call arguments for ${toolName}: ${toolCall.function.arguments}`,
            recoverable: true,
          });
          this.appendToolResult(toolCall.id, toolName, {
            content: `Error: Invalid JSON arguments: ${toolCall.function.arguments}`,
            isError: true,
          });
          continue;
        }

        if (!tool) {
          this.emitEvent({
            type: "error",
            error: `Unknown tool: ${toolName}`,
            recoverable: true,
          });
          this.appendToolResult(toolCall.id, toolName, {
            content: `Error: Unknown tool "${toolName}"`,
            isError: true,
          });
          continue;
        }

        // Fire beforeToolCall hook.
        let effectiveArgs = args;
        if (this.hooks.beforeToolCall) {
          const hookResult = await this.hooks.beforeToolCall(toolName, args);
          if (hookResult.skip) {
            this.appendToolResult(toolCall.id, toolName, {
              content: "Tool call skipped by hook.",
              isError: false,
            });
            continue;
          }
          if (hookResult.modifiedArgs) {
            effectiveArgs = hookResult.modifiedArgs;
          }
        }

        const callId = toolCall.id ?? generateId();
        this.emitEvent({
          type: "toolCall",
          name: toolName,
          args: effectiveArgs,
          id: callId,
        });

        // Execute the tool.
        let result: ToolResult;
        try {
          result = await tool.execute(effectiveArgs);
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          result = { content: `Error: ${errorMsg}`, isError: true };

          // Fire onError hook for recovery.
          if (this.hooks.onError) {
            const recovery = await this.hooks.onError(
              err instanceof Error ? err : new Error(errorMsg),
              { iteration: i, tool: toolName },
            );
            if (recovery.retry) {
              try {
                result = await tool.execute(effectiveArgs);
              } catch (retryErr) {
                const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
                result = { content: `Error on retry: ${retryMsg}`, isError: true };
              }
            } else if (recovery.fallback) {
              result = { content: recovery.fallback, isError: false };
            }
          }
        }

        // Fire afterToolCall hook.
        if (this.hooks.afterToolCall) {
          const hookResult = await this.hooks.afterToolCall(toolName, result);
          if (hookResult.modifiedResult) {
            result = hookResult.modifiedResult;
          }
        }

        this.emitEvent({
          type: "toolResult",
          name: toolName,
          result,
          id: callId,
        });

        toolsUsedSet.add(toolName);
        allToolCalls.push({ name: toolName, args: effectiveArgs, result });
        this.appendToolResult(toolCall.id, toolName, result);
      }

      this.hooks.onIterationEnd?.(i, true);
      this.emitEvent({ type: "iterationEnd", iteration: i, hasMoreToolCalls: true });

      // If this was the last iteration and we still have tool calls,
      // do one final generation without tools to force a text answer —
      // unless the caller opted out (e.g. artifact-first flows that
      // don't want a trailing assistant text and would race the llama
      // context on back-to-back completions).
      if (
        i === maxIterations - 1
        && !this.stopped
        && !this.config.skipFinalForceText
      ) {
        try {
          const condensedForForce = condenseHistory(this.history);
          const forceResult = await agentGenerate(this.llama, condensedForForce, {
            // No tools — force a text response.
            thinking: this.config.thinking,
            thinkingBudget: this.config.thinkingBudget,
            alwaysThinks: this.config.alwaysThinks,
            nativeReasoning: this.config.nativeReasoning,
            maxGenerationTokens: this.config.maxGenerationTokens,
            onEvent: this.emitEvent,
          });

          finalText = forceResult.text;
          finalThinking = forceResult.thinking;
          this.history.push({
            role: "assistant",
            content: forceResult.text,
            ...(forceResult.thinking ? { reasoning_content: forceResult.thinking } : {}),
          });
        } catch {
          // Context overflow on final generation — try with minimal history.
          try {
            const minimalHistory = this.buildMinimalHistory();
            const fallbackResult = await agentGenerate(this.llama, minimalHistory, {
              thinking: this.config.thinking,
              thinkingBudget: this.config.thinkingBudget,
              alwaysThinks: this.config.alwaysThinks,
              nativeReasoning: this.config.nativeReasoning,
              maxGenerationTokens: this.config.maxGenerationTokens,
              onEvent: this.emitEvent,
            });
            finalText = fallbackResult.text;
            finalThinking = fallbackResult.thinking;
          } catch {
            // Nothing more we can do — use whatever text we have.
          }
        }
      }
    }

    const doneEvent: AgentEvent = {
      type: "done",
      finalText,
      thinking: finalThinking,
      toolsUsed: Array.from(toolsUsedSet),
      iterations,
    };
    this.emitEvent(doneEvent);

    return {
      text: finalText,
      thinking: finalThinking,
      toolCalls: allToolCalls,
      iterations,
      history: [...this.history],
    };
  }

  // ---------------------------------------------------------------------------
  // Session Persistence
  // ---------------------------------------------------------------------------

  async saveSession(sessionId?: string): Promise<string> {
    const id = sessionId ?? generateId();
    const session: AgentSession = {
      id,
      history: this.history,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      toolsUsed: Array.from(
        new Set(
          this.history
            .filter((m) => m.role === "assistant" && m.tool_calls)
            .flatMap((m) => m.tool_calls?.map((tc) => tc.function.name) ?? []),
        ),
      ),
      config: {
        systemPrompt: this.config.systemPrompt,
        maxIterations: this.config.maxIterations,
        thinking: this.config.thinking,
      },
    };

    await AsyncStorage.setItem(
      SESSION_KEY_PREFIX + id,
      JSON.stringify(session),
    );
    return id;
  }

  static async loadSession(
    llama: UseLlamaReturn,
    sessionId: string,
    config: AgentConfig,
  ): Promise<Agent> {
    const raw = await AsyncStorage.getItem(SESSION_KEY_PREFIX + sessionId);
    if (!raw) {
      throw new Error(`Agent session not found: ${sessionId}`);
    }

    const session: AgentSession = JSON.parse(raw);
    const agent = new Agent(llama, {
      ...config,
      systemPrompt: config.systemPrompt ?? session.config.systemPrompt,
      maxIterations: config.maxIterations ?? session.config.maxIterations,
      thinking: config.thinking ?? session.config.thinking,
    });

    agent.history = session.history;
    return agent;
  }

  static async listSessions(): Promise<AgentSession[]> {
    const allKeys = await AsyncStorage.getAllKeys();
    const sessionKeys = allKeys.filter((k) => k.startsWith(SESSION_KEY_PREFIX));

    if (sessionKeys.length === 0) return [];

    const pairs = await AsyncStorage.multiGet(sessionKeys);
    const sessions: AgentSession[] = [];

    for (const [, raw] of pairs) {
      if (raw) {
        try {
          sessions.push(JSON.parse(raw) as AgentSession);
        } catch {
          // Skip corrupted entries.
        }
      }
    }

    // Most recent first.
    sessions.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
    return sessions;
  }

  static async deleteSession(sessionId: string): Promise<void> {
    await AsyncStorage.removeItem(SESSION_KEY_PREFIX + sessionId);
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  private buildSystemPrompt(): string {
    const base =
      this.config.systemPrompt ??
      "You are a helpful AI assistant. Be accurate, honest, and concise.";

    const parts = [base];

    // Artifact flows (mini-apps) ship their own tight system prompt and
    // explicitly want to strip chat-mode boilerplate. Chat mode keeps
    // the datetime + tool-guidance suffixes.
    if (!this.config.suppressChatModePromptSuffixes) {
      parts.push(`Current date and time: ${formatPromptDateTime(new Date())}`);
      if (this.tools.size > 0) {
        parts.push(AGENT_TOOL_GUIDANCE);
      }
    }

    return parts.join("\n\n");
  }

  /**
   * Build a minimal history with just the system prompt, user question,
   * and the most recent tool result. Used as a last-resort fallback when
   * the full history overflows the context window.
   */
  private buildMinimalHistory(): StructuredMessages {
    const messages: StructuredMessages = [];

    // System prompt.
    const systemMsg = this.history.find((m) => m.role === "system");
    if (systemMsg) messages.push(systemMsg);

    // Original user message (first user message after system).
    const userMsg = this.history.find((m) => m.role === "user");
    if (userMsg) messages.push(userMsg);

    // Most recent tool result — so the model can synthesize from it.
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (this.history[i].role === "tool") {
        messages.push({
          role: "assistant",
          content: "I searched the web and found the following information:",
        });
        messages.push({
          ...this.history[i],
          content: typeof this.history[i].content === "string"
            ? truncateToolContent(this.history[i].content as string, 500)
            : this.history[i].content,
        });
        break;
      }
    }

    return messages;
  }

  private buildUserContent(
    text: string,
    images?: string[],
  ): string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> {
    if (!images || images.length === 0) {
      return text;
    }

    return [
      { type: "text" as const, text },
      ...images.map((url) => ({
        type: "image_url" as const,
        image_url: { url },
      })),
    ];
  }

  private appendToolResult(
    toolCallId: string | undefined,
    toolName: string,
    result: ToolResult,
  ): void {
    // Cap tool result size to avoid blowing up the context window.
    const content = typeof result.content === "string"
      ? truncateToolContent(result.content, 800)
      : result.content;

    const msg: StructuredMessage = {
      role: "tool",
      content,
      ...(toolCallId ? { tool_call_id: toolCallId } : {}),
    };
    this.history.push(msg);
  }
}
