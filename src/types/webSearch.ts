export interface WebSearchResult {
  id: string;
  title: string;
  url: string;
  source: string;
  snippet: string;
}

export interface WebSearchToolPayload {
  query: string;
  results: Array<Pick<WebSearchResult, "title" | "url" | "source" | "snippet">>;
  error?: string;
}

export interface WebSearchExecutionResult {
  query: string;
  results: WebSearchResult[];
  serializedContent: string;
  error?: string;
}