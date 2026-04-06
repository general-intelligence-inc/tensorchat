const THINK_TAG_PATTERN = /<\s*\/\s*think\s*>|<\s*think\s*>|<\|channel>thought\n|<channel\|>/gi;
const THINK_OPEN_PATTERN = /<\s*think\s*>|<\|channel>thought\n/i;
const THINK_TAG_STRIP_PATTERN = /<\s*\/?\s*think\s*>|<\|channel>thought\n|<channel\|>/gi;
const TOOL_CALL_BLOCK_PATTERNS = [
  /<\|tool_call_start\|>[\s\S]*?<\|tool_call_end\|>/gi,
  /<\|tool_call:begin\|>[\s\S]*?<\|tool_call:end\|>/gi,
  /<\|tool_calls_section_begin\|>[\s\S]*?<\|tool_calls_section_end\|>/gi,
  /<\|tool_call>[\s\S]*?<tool_call\|>/gi,
  /<\|tool_response>[\s\S]*?<tool_response\|>/gi,
  /<tool_calls>\s*\[[\s\S]*?\]\s*<\/tool_calls>/gi,
  /<tool_call>[\s\S]*?<\/tool_call>/gi,
  /<tool_response>[\s\S]*?<\/tool_response>/gi,
  /\[TOOL_CALLS\][\s\S]*?(?=(?:\n\n)|$)/gi,
  /<｜tool▁calls▁begin｜>[\s\S]*?<｜tool▁calls▁end｜>/gi,
  /<｜tool_calls_begin｜>[\s\S]*?<｜tool▁calls▁end｜>/gi,
  /<｜tool calls begin｜>[\s\S]*?<｜tool▁calls▁end｜>/gi,
  /<｜tool\\_calls\\_begin｜>[\s\S]*?<｜tool▁calls▁end｜>/gi,
  /<｜tool▁calls｜>[\s\S]*?<｜tool▁calls▁end｜>/gi,
];
const TOOL_CALL_PARTIAL_PATTERNS = [
  /<\|tool_call_start\|>[\s\S]*$/gi,
  /<\|tool_call:begin\|>[\s\S]*$/gi,
  /<\|tool_calls_section_begin\|>[\s\S]*$/gi,
  /<\|tool_calls\|>[\s\S]*$/gi,
  /<\|tool_call>[\s\S]*$/gi,
  /<\|tool_response>[\s\S]*$/gi,
  /<tool_calls>\s*\[[\s\S]*$/gi,
  /<tool_call>[\s\S]*$/gi,
  /<tool_response>[\s\S]*$/gi,
  /\[TOOL_CALLS\][\s\S]*$/gi,
  /<｜tool▁calls▁begin｜>[\s\S]*$/gi,
  /<｜tool_calls_begin｜>[\s\S]*$/gi,
  /<｜tool calls begin｜>[\s\S]*$/gi,
  /<｜tool\\_calls\\_begin｜>[\s\S]*$/gi,
  /<｜tool▁calls｜>[\s\S]*$/gi,
];

export interface ParsedThinkingContent {
  thinking: string | null;
  response: string;
}

export function stripThinkingTags(text: string): string {
  return text.replace(THINK_TAG_STRIP_PATTERN, "");
}

export function stripToolCallMarkup(text: string): string {
  let next = text;

  TOOL_CALL_BLOCK_PATTERNS.forEach((pattern) => {
    next = next.replace(pattern, "");
  });

  TOOL_CALL_PARTIAL_PATTERNS.forEach((pattern) => {
    next = next.replace(pattern, "");
  });

  return next;
}

export function parseThinking(
  content: string,
  options?: { implicitThinkOpen?: boolean },
): ParsedThinkingContent {
  const source = options?.implicitThinkOpen ? `<think>${content}` : content;
  const thinkingParts: string[] = [];
  const responseParts: string[] = [];

  let inThink = false;
  let cursor = 0;

  for (const match of source.matchAll(THINK_TAG_PATTERN)) {
    const index = match.index ?? 0;
    const tag = match[0] ?? "";
    const chunk = source.slice(cursor, index);

    if (chunk.length > 0) {
      if (inThink) {
        thinkingParts.push(chunk);
      } else {
        responseParts.push(chunk);
      }
    }

    inThink = THINK_OPEN_PATTERN.test(tag);
    cursor = index + tag.length;
  }

  const tail = source.slice(cursor);
  if (tail.length > 0) {
    if (inThink) {
      thinkingParts.push(tail);
    } else {
      responseParts.push(tail);
    }
  }

  const thinkingText = thinkingParts.join("").trim();
  const responseText = stripToolCallMarkup(
    stripThinkingTags(responseParts.join("")),
  ).trim();

  return {
    thinking: thinkingText.length > 0 ? thinkingText : null,
    response: responseText,
  };
}

export function combineReasoningAndResponse(
  reasoning: string | null | undefined,
  response: string,
): string {
  const cleanedReasoning = (reasoning ?? "").trim();
  // Use parseThinking to properly extract only the non-thinking response,
  // rather than stripThinkingTags which removes tags but keeps the text between them.
  const parsedResponse = parseThinking(response);
  const cleanedResponse = stripToolCallMarkup(
    parsedResponse.response,
  ).trim();

  // If response contained its own thinking, merge it with the explicit reasoning
  const mergedReasoning = parsedResponse.thinking
    ? (cleanedReasoning
        ? `${cleanedReasoning}\n${parsedResponse.thinking}`
        : parsedResponse.thinking)
    : cleanedReasoning;

  return mergedReasoning
    ? `<think>${mergedReasoning}</think>${cleanedResponse}`
    : cleanedResponse;
}

export function mergeReasoningIntoContent(
  existingContent: string,
  nextContent: string,
): string {
  const preservedReasoning = parseThinking(existingContent).thinking;
  const nextParsed = parseThinking(nextContent);

  return combineReasoningAndResponse(
    nextParsed.thinking ?? preservedReasoning,
    nextParsed.response,
  );
}