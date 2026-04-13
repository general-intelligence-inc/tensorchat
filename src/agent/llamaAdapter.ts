import type { UseLlamaReturn, LlamaGenerationOptions, LlamaStreamUpdate } from "../hooks/useLlama";
import type {
  AgentEvent,
  AgentGenerationResult,
  ToolDefinition,
  LlamaToolDefinition,
  StructuredMessages,
} from "./types";

/**
 * Convert the agent's ToolDefinition to the LlamaToolDefinition format
 * expected by useLlama / llama.rn.
 */
function toLlamaToolDefinitions(tools: ToolDefinition[]): LlamaToolDefinition[] {
  return tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

/**
 * Build a tool-definitions block for embedding in the system prompt.
 * Used for alwaysThinks models where passing tools through llama.rn's
 * grammar system would conflict with native thinking tokens.
 */
function buildToolSystemPromptBlock(tools: ToolDefinition[]): string {
  const toolDescriptions = tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));

  return (
    "\n\nYou have access to the following tools. To use a tool, output a tool call " +
    "in this exact format:\n" +
    "<|tool_call_start|>[tool_name(param=\"value\")]<|tool_call_end|>\n\n" +
    "Available tools:\n" +
    JSON.stringify(toolDescriptions, null, 2)
  );
}

export interface AgentGenerateOptions {
  tools?: ToolDefinition[];
  thinking?: boolean;
  thinkingBudget?: number;
  alwaysThinks?: boolean;
  /** Route tool definitions via system prompt instead of llama.rn GBNF grammar. */
  systemPromptTools?: boolean;
  nativeReasoning?: boolean;
  /** Override the per-call output token cap (`n_predict`). */
  maxGenerationTokens?: number;
  onEvent: (event: AgentEvent) => void;
}

/**
 * Bridge between the Agent SDK and useLlama's generateResponse.
 *
 * Handles:
 * 1. Converting tool definitions to llama.rn format
 * 2. Streaming token updates as AgentEvents
 * 3. Extracting tool calls from the generation result
 * 4. Separating thinking from response content
 */
export async function agentGenerate(
  llama: UseLlamaReturn,
  messages: StructuredMessages,
  options: AgentGenerateOptions,
): Promise<AgentGenerationResult> {
  const {
    tools,
    thinking,
    thinkingBudget,
    alwaysThinks,
    systemPromptTools,
    nativeReasoning,
    maxGenerationTokens,
    onEvent,
  } = options;

  const hasTools = Array.isArray(tools) && tools.length > 0;
  // Use system-prompt tool routing when the model always emits think tags
  // (which conflict with GBNF grammar) OR when explicitly requested.
  const useSystemPromptTools = alwaysThinks || systemPromptTools;

  // For models that need system-prompt tools, embed tool definitions in the
  // system prompt instead of passing them through llama.rn's grammar system.
  let messagesWithToolPrompt = messages;
  if (hasTools && useSystemPromptTools) {
    const toolBlock = buildToolSystemPromptBlock(tools);
    messagesWithToolPrompt = messages.map((msg, idx) => {
      if (idx === 0 && msg.role === "system" && typeof msg.content === "string") {
        return { ...msg, content: msg.content + toolBlock };
      }
      return msg;
    });

    // If there's no system message, prepend one with tool definitions.
    if (!messages.some((m) => m.role === "system")) {
      messagesWithToolPrompt = [
        { role: "system" as const, content: toolBlock.trim() },
        ...messages,
      ];
    }
  }

  const llamaOptions: LlamaGenerationOptions = {
    thinking: hasTools ? false : (thinking ?? false),
    alwaysThinks: alwaysThinks ?? false,
    nativeReasoning: nativeReasoning ?? false,
    ...(thinkingBudget != null && !hasTools
      ? {
          thinkingBudget: {
            maxReasoningTokens: thinkingBudget,
            maxGenerationTokens: 1024,
            promptGuidance: "Keep reasoning short, no repetition, and move to the answer as soon as you can.",
          },
        }
      : {}),
    // Pass tools through to llama.rn for grammar-based structured tool
    // calling, unless the model uses system-prompt tool routing.
    ...(hasTools && !useSystemPromptTools ? { tools: toLlamaToolDefinitions(tools) } : {}),
    // Explicit override for the per-call output cap. Overrides the budget
    // derived from thinking state inside useLlama.generateResponse.
    ...(typeof maxGenerationTokens === "number"
      ? { maxGenerationTokens }
      : {}),
  };

  let lastThinking = "";
  let lastResponse = "";

  const onToken = (data: LlamaStreamUpdate): void => {
    // Emit thinking events when reasoning content changes.
    if (data.reasoningContent && data.reasoningContent !== lastThinking) {
      lastThinking = data.reasoningContent;
      onEvent({ type: "thinking", content: data.reasoningContent });
    }

    // Emit text events when response content changes.
    if (data.responseContent && data.responseContent !== lastResponse) {
      lastResponse = data.responseContent;
      onEvent({ type: "text", content: data.responseContent });
    }
  };

  const result = await llama.generateResponse(
    messagesWithToolPrompt,
    onToken,
    llamaOptions,
  );

  return {
    text: result.responseContent,
    thinking: result.reasoningContent || undefined,
    toolCalls: result.toolCalls,
    rawOutput: result.content,
  };
}
