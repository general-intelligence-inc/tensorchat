import { runDuckDuckGoSearch } from "../../utils/webSearch";
import type { Tool } from "../types";

export const webSearchTool: Tool = {
  definition: {
    name: "web_search",
    description:
      "Search the web for up-to-date information. Use when the user asks about " +
      "current events, recent changes, live data, or facts you are not confident " +
      "are still current.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query to look up",
        },
        max_results: {
          type: "integer",
          description: "Maximum number of results to return (1-5)",
          minimum: 1,
          maximum: 5,
        },
      },
      required: ["query"],
    },
  },

  async execute(args) {
    const query = typeof args.query === "string" ? args.query : String(args.query ?? "");
    const maxResults =
      typeof args.max_results === "number"
        ? Math.min(5, Math.max(1, args.max_results))
        : 3;

    const result = await runDuckDuckGoSearch(query, maxResults);

    return {
      content: result.serializedContent,
      metadata: {
        webSearchResults: result.results,
        query: result.query,
      },
      isError: !!result.error && result.results.length === 0,
    };
  },
};
