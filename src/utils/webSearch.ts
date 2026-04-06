import type {
  WebSearchExecutionResult,
  WebSearchResult,
  WebSearchToolPayload,
} from "../types/webSearch";

const DUCKDUCKGO_ENDPOINT = "https://api.duckduckgo.com/";
const DUCKDUCKGO_HTML_ENDPOINT = "https://html.duckduckgo.com/html/";
const REQUEST_TIMEOUT_MS = 8000;
const DEFAULT_MAX_RESULTS = 5;
const MAX_RESULTS_LIMIT = 5;
const DEFAULT_REGION = "wt-wt";
type DuckDuckGoSafeSearch = "off" | "moderate" | "on";

const DEFAULT_SAFESEARCH: DuckDuckGoSafeSearch = "moderate";
const SAFESEARCH_PARAM_BY_MODE: Record<DuckDuckGoSafeSearch, string> = {
  off: "-2",
  moderate: "-1",
  on: "1",
};

type DuckDuckGoTopic = {
  FirstURL?: string;
  Text?: string;
  Result?: string;
  Topics?: DuckDuckGoTopic[];
};

type DuckDuckGoResponse = {
  AbstractText?: string;
  AbstractURL?: string;
  AbstractSource?: string;
  Heading?: string;
  Results?: DuckDuckGoTopic[];
  RelatedTopics?: DuckDuckGoTopic[];
};

type FetchResult<T> = {
  ok: true;
  value: T;
} | {
  ok: false;
  error: string;
};

export const WEB_SEARCH_TOOL = {
  type: "function" as const,
  function: {
    name: "web_search",
    description:
      "Search DuckDuckGo for up-to-date web information and return relevant results.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query to look up on the web.",
        },
        max_results: {
          type: "integer",
          description: "Maximum number of search results to return. Use 1 to 5.",
          minimum: 1,
          maximum: MAX_RESULTS_LIMIT,
        },
      },
      required: ["query"],
    },
  },
};

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stripHtml(value: string): string {
  return normalizeWhitespace(value.replace(/<[^>]+>/g, " "));
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function toSourceLabel(url: string, fallback?: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return fallback?.trim() || "web";
  }
}

function buildTitle(url: string, text: string, fallback?: string): string {
  if (fallback && fallback.trim().length > 0) {
    return fallback.trim();
  }

  const [candidate] = text.split(/\s[-|:]\s/, 1);
  if (candidate && candidate.trim().length > 0) {
    return candidate.trim();
  }

  return toSourceLabel(url, "Result");
}

function flattenTopics(topics: DuckDuckGoTopic[] | undefined): DuckDuckGoTopic[] {
  if (!topics || topics.length === 0) {
    return [];
  }

  return topics.flatMap((topic) => {
    if (Array.isArray(topic.Topics) && topic.Topics.length > 0) {
      return flattenTopics(topic.Topics);
    }
    return [topic];
  });
}

function mapTopicToResult(topic: DuckDuckGoTopic, index: number): WebSearchResult | null {
  const url = typeof topic.FirstURL === "string" ? topic.FirstURL.trim() : "";
  const text = typeof topic.Text === "string"
    ? stripHtml(topic.Text)
    : typeof topic.Result === "string"
      ? stripHtml(topic.Result)
      : "";

  if (!url || !text) {
    return null;
  }

  return {
    id: `ddg-topic-${index}`,
    title: buildTitle(url, text),
    url,
    source: toSourceLabel(url),
    snippet: text,
  };
}

function extractRedirectUrl(href: string): string {
  const decodedHref = decodeHtmlEntities(href.trim());

  try {
    const candidate = decodedHref.startsWith("//")
      ? `https:${decodedHref}`
      : decodedHref.startsWith("/")
        ? `https://duckduckgo.com${decodedHref}`
        : decodedHref;
    const url = new URL(candidate);
    const redirectUrl = url.searchParams.get("uddg");

    if (redirectUrl) {
      return decodeURIComponent(redirectUrl);
    }

    return candidate;
  } catch {
    return decodedHref;
  }
}

function parseHtmlSearchResults(html: string, maxResults: number): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  const deduped = new Set<string>();
  const resultPattern = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(resultPattern)) {
    if (results.length >= maxResults) {
      break;
    }

    const href = match[1] ?? "";
    const titleHtml = match[2] ?? "";
    const snippetHtml = match[3] ?? "";
    const url = extractRedirectUrl(href);
    const title = stripHtml(decodeHtmlEntities(titleHtml));
    const snippet = stripHtml(decodeHtmlEntities(snippetHtml));

    if (!url || !title || !snippet || deduped.has(url)) {
      continue;
    }

    deduped.add(url);
    results.push({
      id: `ddg-html-${results.length}`,
      title,
      url,
      source: toSourceLabel(url),
      snippet,
    });
  }

  return results;
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchInstantAnswerResults(
  query: string,
  maxResults: number,
): Promise<FetchResult<WebSearchResult[]>> {
  try {
    const params = new URLSearchParams({
      q: query,
      format: "json",
      no_html: "1",
      skip_disambig: "1",
      t: "tensorchat",
    });
    const response = await fetchWithTimeout(`${DUCKDUCKGO_ENDPOINT}?${params.toString()}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`DuckDuckGo instant answers failed with HTTP ${response.status}`);
    }

    const body = (await response.json()) as DuckDuckGoResponse;
    return {
      ok: true,
      value: normalizeWebSearchResults(body, maxResults),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error && error.name === "AbortError"
        ? "DuckDuckGo instant answers timed out."
        : error instanceof Error
          ? error.message
          : String(error),
    };
  }
}

async function fetchHtmlSearchResults(
  query: string,
  maxResults: number,
): Promise<FetchResult<WebSearchResult[]>> {
  try {
    const params = new URLSearchParams({
      q: query,
      kl: DEFAULT_REGION,
      kp: SAFESEARCH_PARAM_BY_MODE[DEFAULT_SAFESEARCH],
    });
    const response = await fetchWithTimeout(`${DUCKDUCKGO_HTML_ENDPOINT}?${params.toString()}`, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "Mozilla/5.0 TensorChat/1.0",
      },
    });

    if (!response.ok) {
      throw new Error(`DuckDuckGo HTML search failed with HTTP ${response.status}`);
    }

    const html = await response.text();
    return {
      ok: true,
      value: parseHtmlSearchResults(html, maxResults),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error && error.name === "AbortError"
        ? "DuckDuckGo HTML search timed out."
        : error instanceof Error
          ? error.message
          : String(error),
    };
  }
}

function mergeResults(
  primaryResults: WebSearchResult[],
  secondaryResults: WebSearchResult[],
  maxResults: number,
): WebSearchResult[] {
  const deduped = new Map<string, WebSearchResult>();

  [...primaryResults, ...secondaryResults].forEach((result) => {
    if (!deduped.has(result.url) && deduped.size < maxResults) {
      deduped.set(result.url, result);
    }
  });

  return Array.from(deduped.values());
}

function normalizeWebSearchResults(
  response: DuckDuckGoResponse,
  maxResults: number,
): WebSearchResult[] {
  const deduped = new Map<string, WebSearchResult>();

  if (response.AbstractURL && response.AbstractText) {
    const abstractUrl = response.AbstractURL.trim();
    const abstractText = normalizeWhitespace(response.AbstractText);

    if (abstractUrl && abstractText) {
      deduped.set(abstractUrl, {
        id: "ddg-abstract",
        title: buildTitle(abstractUrl, abstractText, response.Heading),
        url: abstractUrl,
        source: response.AbstractSource?.trim() || toSourceLabel(abstractUrl),
        snippet: abstractText,
      });
    }
  }

  const topics = [
    ...flattenTopics(response.Results),
    ...flattenTopics(response.RelatedTopics),
  ];

  topics.forEach((topic, index) => {
    if (deduped.size >= maxResults) {
      return;
    }

    const result = mapTopicToResult(topic, index);
    if (result && !deduped.has(result.url)) {
      deduped.set(result.url, result);
    }
  });

  return Array.from(deduped.values()).slice(0, maxResults);
}

function buildToolPayload(
  query: string,
  results: WebSearchResult[],
  error?: string,
): WebSearchToolPayload {
  return {
    query,
    results: results.map(({ title, url, source, snippet }) => ({
      title,
      url,
      source,
      snippet,
    })),
    ...(error ? { error } : {}),
  };
}

export async function runDuckDuckGoSearch(
  query: string,
  requestedMaxResults?: number,
): Promise<WebSearchExecutionResult> {
  const trimmedQuery = query.trim();
  const maxResults = Math.min(
    MAX_RESULTS_LIMIT,
    Math.max(1, requestedMaxResults ?? DEFAULT_MAX_RESULTS),
  );

  if (!trimmedQuery) {
    const error = "Missing search query.";
    return {
      query: trimmedQuery,
      results: [],
      serializedContent: JSON.stringify(buildToolPayload(trimmedQuery, [], error)),
      error,
    };
  }

  const instantAnswerResult = await fetchInstantAnswerResults(trimmedQuery, maxResults);
  const htmlSearchResult = await fetchHtmlSearchResults(trimmedQuery, maxResults);

  const answerResults = instantAnswerResult.ok ? instantAnswerResult.value : [];
  const htmlResults = htmlSearchResult.ok ? htmlSearchResult.value : [];
  const results = mergeResults(answerResults, htmlResults, maxResults);

  const error = results.length > 0
    ? undefined
    : htmlSearchResult.ok
      ? "No relevant DuckDuckGo results found."
      : htmlSearchResult.error || instantAnswerResult.ok
        ? undefined
        : instantAnswerResult.error;

  return {
    query: trimmedQuery,
    results,
    serializedContent: JSON.stringify(buildToolPayload(trimmedQuery, results, error)),
    ...(error ? { error } : {}),
  };
}