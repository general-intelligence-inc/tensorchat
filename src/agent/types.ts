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
  nativeReasoning?: boolean;
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
