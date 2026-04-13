import type {
  LlamaToolCall,
  LlamaToolDefinition,
  StructuredMessage,
  StructuredMessages,
} from "../hooks/useLlama";

// ---------------------------------------------------------------------------
// Tool System
// ---------------------------------------------------------------------------

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface Tool {
  definition: ToolDefinition;
  execute(args: Record<string, unknown>): Promise<ToolResult>;
}

export interface ToolResult {
  /** Serialized result string fed back to the model. */
  content: string;
  /** Arbitrary metadata for UI consumption (e.g. WebSearchResult[]). */
  metadata?: Record<string, unknown>;
  /** Whether the tool execution resulted in an error. */
  isError?: boolean;
}

// ---------------------------------------------------------------------------
// Agent Events — streamed to the UI via `onEvent` callback
// ---------------------------------------------------------------------------

export type AgentEvent =
  | { type: "thinking"; content: string }
  | { type: "text"; content: string }
  | { type: "toolCall"; name: string; args: Record<string, unknown>; id: string }
  | { type: "toolResult"; name: string; result: ToolResult; id: string }
  | { type: "iterationStart"; iteration: number }
  | { type: "iterationEnd"; iteration: number; hasMoreToolCalls: boolean }
  | { type: "error"; error: string; recoverable: boolean }
  | {
      type: "done";
      finalText: string;
      thinking?: string;
      toolsUsed: string[];
      iterations: number;
    };

// ---------------------------------------------------------------------------
// Lifecycle Hooks
// ---------------------------------------------------------------------------

export interface AgentHooks {
  beforeToolCall?: (
    tool: string,
    args: Record<string, unknown>,
  ) => Promise<{ skip?: boolean; modifiedArgs?: Record<string, unknown> }>;

  afterToolCall?: (
    tool: string,
    result: ToolResult,
  ) => Promise<{ modifiedResult?: ToolResult }>;

  onError?: (
    error: Error,
    context: { iteration: number; tool?: string },
  ) => Promise<{ retry?: boolean; fallback?: string }>;

  onIterationStart?: (
    iteration: number,
    history: StructuredMessages,
  ) => void;

  onIterationEnd?: (
    iteration: number,
    hasMoreToolCalls: boolean,
  ) => void;
}

// ---------------------------------------------------------------------------
// Agent Config & Result
// ---------------------------------------------------------------------------

export interface AgentConfig {
  systemPrompt?: string;
  tools?: Tool[];
  maxIterations?: number;
  thinking?: boolean;
  thinkingBudget?: number;
  alwaysThinks?: boolean;
  /** Route tool definitions via system prompt instead of llama.rn GBNF grammar. */
  systemPromptTools?: boolean;
  nativeReasoning?: boolean;
  /** Override the per-call output token cap (`n_predict`). */
  maxGenerationTokens?: number;
  /**
   * When true, skip the "forced text response" final generation that
   * normally runs at the end of the loop when tool calls are still in
   * flight. Used by artifact-first flows (e.g. Mini Apps) where the tool's
   * side effect IS the output — a second generation is both wasteful and
   * risks "Context is busy" races in llama.rn on back-to-back completions.
   */
  skipFinalForceText?: boolean;
  /**
   * When true, `text` and `thinking` events fire from the very first
   * iteration even when tools are present. By default Agent suppresses
   * first-iteration streaming on tool-enabled runs (so a failed tool
   * call doesn't dump half-response text into the UI before the
   * fallback rerun). Mini-app flows want the opposite — they drive
   * a phased progress indicator off those events and need them live.
   */
  streamFirstIteration?: boolean;
  /**
   * When true, skip Agent's "direct-search fallback" path — the thing
   * that auto-calls the first registered tool with
   * `{ query: userMessage }` whenever the model fails to emit a tool
   * call. That path is a chat-mode crutch for web search; in artifact
   * flows (mini-apps) it's both semantically wrong (the tool doesn't
   * take a `query` arg) AND causes back-to-back llama completions that
   * race llama.rn into "Context is busy". Artifact flows should set
   * this to true and let their harness handle the "no tool call"
   * outcome as a retry-worthy failure.
   */
  disableDirectSearchFallback?: boolean;
  /**
   * When true, skip the default chat-mode prompt suffixes: the current
   * datetime line and the AGENT_TOOL_GUIDANCE block (search-results
   * synthesis instructions + "never include URLs"). Artifact flows
   * that ship their own tight system prompt (mini-apps) set this to
   * strip ~400 tokens of chat-mode boilerplate that just confuses the
   * model when the tool's purpose is to emit code, not answer
   * questions.
   */
  suppressChatModePromptSuffixes?: boolean;
  hooks?: AgentHooks;
  onEvent?: (event: AgentEvent) => void;
}

export interface AgentResult {
  text: string;
  thinking?: string;
  toolCalls: Array<{
    name: string;
    args: Record<string, unknown>;
    result: ToolResult;
  }>;
  iterations: number;
  history: StructuredMessages;
}

// ---------------------------------------------------------------------------
// Internal generation result from the llama adapter
// ---------------------------------------------------------------------------

export interface AgentGenerationResult {
  text: string;
  thinking?: string;
  toolCalls: LlamaToolCall[];
  rawOutput: string;
}

// ---------------------------------------------------------------------------
// Session Persistence
// ---------------------------------------------------------------------------

export interface AgentSession {
  id: string;
  history: StructuredMessages;
  createdAt: number;
  lastActiveAt: number;
  toolsUsed: string[];
  config: Pick<AgentConfig, "systemPrompt" | "maxIterations" | "thinking">;
}

// ---------------------------------------------------------------------------
// Re-exports for consumer convenience
// ---------------------------------------------------------------------------

export type {
  LlamaToolCall,
  LlamaToolDefinition,
  StructuredMessage,
  StructuredMessages,
};
