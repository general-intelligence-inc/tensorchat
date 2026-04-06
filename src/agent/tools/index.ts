import type { Tool, ToolResult } from "../types";

export { webSearchTool } from "./webSearch";

/**
 * Helper for creating tools inline without implementing the Tool interface
 * manually. Useful for simple tools that don't need a separate file.
 *
 * @example
 * const calculator = createTool(
 *   "calculator",
 *   "Evaluate a math expression",
 *   { type: "object", properties: { expression: { type: "string" } }, required: ["expression"] },
 *   async (args) => ({ content: String(eval(args.expression)) }),
 * );
 */
export function createTool(
  name: string,
  description: string,
  parameters: Record<string, unknown>,
  execute: (args: Record<string, unknown>) => Promise<ToolResult>,
): Tool {
  return {
    definition: { name, description, parameters },
    execute,
  };
}
