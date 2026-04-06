/*
  Lightweight parser harness for <think> handling.
  Run with: node scripts/test-think-parser.js
*/

const TOOL_CALL_BLOCK_PATTERNS = [
  /<\|tool_call:begin\|>[\s\S]*?<\|tool_call:end\|>/gi,
  /<\|tool_calls_section_begin\|>[\s\S]*?<\|tool_calls_section_end\|>/gi,
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
  /<\|tool_call:begin\|>[\s\S]*$/gi,
  /<\|tool_calls_section_begin\|>[\s\S]*$/gi,
  /<\|tool_calls\|>[\s\S]*$/gi,
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

function stripToolCallMarkup(text) {
  let next = text;

  TOOL_CALL_BLOCK_PATTERNS.forEach((pattern) => {
    next = next.replace(pattern, '');
  });

  TOOL_CALL_PARTIAL_PATTERNS.forEach((pattern) => {
    next = next.replace(pattern, '');
  });

  return next;
}

function parseThinking(content) {
  const tagPattern = /<\s*\/\s*think\s*>|<\s*think\s*>/gi;
  const openingPattern = /<\s*think\s*>/i;

  const thinkingParts = [];
  const responseParts = [];

  let inThink = false;
  let cursor = 0;

  for (const match of content.matchAll(tagPattern)) {
    const index = match.index ?? 0;
    const tag = match[0] ?? '';
    const chunk = content.slice(cursor, index);

    if (chunk.length > 0) {
      if (inThink) {
        thinkingParts.push(chunk);
      } else {
        responseParts.push(chunk);
      }
    }

    inThink = openingPattern.test(tag);
    cursor = index + tag.length;
  }

  const tail = content.slice(cursor);
  if (tail.length > 0) {
    if (inThink) {
      thinkingParts.push(tail);
    } else {
      responseParts.push(tail);
    }
  }

  const thinkingText = thinkingParts.join('').trim();
  const responseText = stripToolCallMarkup(
    responseParts
      .join('')
      .replace(/<\s*\/?\s*think\s*>/gi, ''),
  ).trim();

  return {
    thinking: thinkingText.length > 0 ? thinkingText : null,
    response: responseText,
  };
}

function chooseFinalOutput({
  reasoning,
  finalResponse,
  finalThinking,
  lastCombined,
  rawFinalText,
  streamedResponse,
}) {
  const hasThinkTag = (text) => /<\s*think\s*>/i.test(text || '');

  if (reasoning && finalThinking) {
    return `<think>${finalThinking}</think>${finalResponse}`;
  }

  if (reasoning) {
    if (hasThinkTag(lastCombined)) return (lastCombined || '').trim();
    if (hasThinkTag(rawFinalText)) return (rawFinalText || '').trim();
    if (hasThinkTag(streamedResponse)) return (streamedResponse || '').trim();
  }

  return (finalResponse || '').trim();
}

function mergeReasoningIntoContent(existingContent, nextContent) {
  const preservedReasoning = parseThinking(existingContent).thinking;
  const nextParsed = parseThinking(nextContent);

  return preservedReasoning || nextParsed.thinking
    ? `<think>${(nextParsed.thinking || preservedReasoning).trim()}</think>${nextParsed.response}`
    : nextParsed.response;
}

function createStreamCombiner({ reasoning }) {
  let rawAccum = '';
  let thinkingAccum = '';
  let responseAccum = '';

  return (data) => {
    const hasReasoningChunk = reasoning && typeof data.reasoning_content === 'string';

    if (typeof data.accumulated_text === 'string') {
      rawAccum = data.accumulated_text;
    } else if (typeof data.token === 'string' && data.token.length > 0) {
      rawAccum += data.token;
    }

    const parsedRaw = reasoning && rawAccum.length > 0
      ? parseThinking(rawAccum.startsWith('<think>') ? rawAccum : `<think>${rawAccum}`)
      : { thinking: null, response: '' };

    if (reasoning && rawAccum.length > 0) {
      thinkingAccum = parsedRaw.thinking ?? '';
      responseAccum = parsedRaw.response;
    }

    if (hasReasoningChunk) {
      if (data.reasoning_content.length >= thinkingAccum.length) {
        thinkingAccum = data.reasoning_content;
      } else {
        thinkingAccum += data.reasoning_content;
      }
    }

    if (!reasoning && typeof data.content === 'string') {
      responseAccum = stripToolCallMarkup(
        data.content.replace(/<\s*\/?\s*think\s*>/gi, ''),
      ).trim();
    } else if (!reasoning && typeof data.accumulated_text === 'string') {
      const parsedAccum = parseThinking(data.accumulated_text);
      responseAccum = parsedAccum.response;
    } else if (!reasoning && typeof data.token === 'string' && data.token.length > 0) {
      responseAccum += stripToolCallMarkup(
        data.token.replace(/<\s*\/?\s*think\s*>/gi, ''),
      ).trim();
    }

    return reasoning && thinkingAccum
      ? `<think>${thinkingAccum}</think>${responseAccum}`
      : responseAccum;
  };
}

function shouldFallbackToNonThinking({
  reasoningEnabled,
  isVisionRequest,
  manualStopRequested,
  reasoningTokenCount,
  maxReasoningTokens,
  responseContent,
  reasoningContent,
}) {
  if (!reasoningEnabled || isVisionRequest || manualStopRequested) {
    return false;
  }

  if (responseContent.trim().length > 0) {
    return false;
  }

  if (reasoningTokenCount >= maxReasoningTokens) {
    return true;
  }

  return reasoningContent.trim().length > 0;
}

const cases = [
  {
    name: 'basic complete block',
    input: '<think>Reasoning here</think>Final answer',
    expectedThinking: 'Reasoning here',
    expectedResponse: 'Final answer',
  },
  {
    name: 'multiple blocks',
    input: 'Intro<think>R1</think>Middle<think>R2</think>End',
    expectedThinking: 'R1R2',
    expectedResponse: 'IntroMiddleEnd',
  },
  {
    name: 'open think while streaming',
    input: '<think>Still thinking...',
    expectedThinking: 'Still thinking...',
    expectedResponse: '',
  },
  {
    name: 'no thinking',
    input: 'Only answer content',
    expectedThinking: null,
    expectedResponse: 'Only answer content',
  },
  {
    name: 'empty think block',
    input: '<think>   </think>Answer only',
    expectedThinking: null,
    expectedResponse: 'Answer only',
  },
  {
    name: 'stray close tag residue',
    input: 'Answer text </think> more answer',
    expectedThinking: null,
    expectedResponse: 'Answer text  more answer',
  },
  {
    name: 'tags with spacing + uppercase',
    input: 'A <THINK>R</THINK> B',
    expectedThinking: 'R',
    expectedResponse: 'A  B',
  },
  {
    name: 'prefix before open think',
    input: 'Prefix\n<think>Reasoning\nmore</think>\nAnswer',
    expectedThinking: 'Reasoning\nmore',
    expectedResponse: 'Prefix\n\nAnswer',
  },
  {
    name: 'strip tool call section from response',
    input: 'Answer before<|tool_calls_section_begin|>[{"name":"web_search"}]<|tool_calls_section_end|>Answer after',
    expectedThinking: null,
    expectedResponse: 'Answer beforeAnswer after',
  },
  {
    name: 'strip partial tool call block while streaming',
    input: 'Visible text<|tool_call:begin|>{"name":"web_search"}',
    expectedThinking: null,
    expectedResponse: 'Visible text',
  },
  {
    name: 'strip xml tool call block from response',
    input: 'Lead text<tool_call><function=web_search><parameter=query>latest news</parameter></function></tool_call>Tail text',
    expectedThinking: null,
    expectedResponse: 'Lead textTail text',
  },
  {
    name: 'strip partial xml tool call while streaming',
    input: 'Visible text<tool_call><function=web_search><parameter=query>latest news',
    expectedThinking: null,
    expectedResponse: 'Visible text',
  },
  {
    name: 'strip tool response xml block',
    input: 'Answer<tool_response>{"query":"latest news","results":[]}</tool_response>After',
    expectedThinking: null,
    expectedResponse: 'AnswerAfter',
  },
];

let passed = 0;
for (const testCase of cases) {
  const actual = parseThinking(testCase.input);
  const ok =
    actual.thinking === testCase.expectedThinking &&
    actual.response === testCase.expectedResponse;

  if (ok) {
    passed += 1;
    console.log(`PASS: ${testCase.name}`);
  } else {
    console.log(`FAIL: ${testCase.name}`);
    console.log(`  input: ${JSON.stringify(testCase.input)}`);
    console.log(`  expected: ${JSON.stringify({ thinking: testCase.expectedThinking, response: testCase.expectedResponse })}`);
    console.log(`  actual:   ${JSON.stringify(actual)}`);
  }
}

console.log(`\n${passed}/${cases.length} tests passed.`);

if (passed !== cases.length) {
  process.exitCode = 1;
}

console.log('\nFinalization regression tests');

const finalizationCases = [
  {
    name: 'preserve streamed think when final fields omit reasoning',
    input: {
      reasoning: true,
      finalResponse: 'Final answer only',
      finalThinking: '',
      lastCombined: '<think>step by step</think>Final answer only',
      rawFinalText: 'Final answer only',
      streamedResponse: 'Final answer only',
    },
    expected: '<think>step by step</think>Final answer only',
  },
  {
    name: 'prefer structured final reasoning when present',
    input: {
      reasoning: true,
      finalResponse: 'Final answer only',
      finalThinking: 'clean reasoning',
      lastCombined: '<think>older reasoning</think>intermediate',
      rawFinalText: 'Final answer only',
      streamedResponse: 'Final answer only',
    },
    expected: '<think>clean reasoning</think>Final answer only',
  },
  {
    name: 'reasoning disabled returns clean final response',
    input: {
      reasoning: false,
      finalResponse: 'Final answer only',
      finalThinking: '',
      lastCombined: '<think>hidden</think>Final answer only',
      rawFinalText: '<think>hidden</think>Final answer only',
      streamedResponse: '<think>hidden</think>Final answer only',
    },
    expected: 'Final answer only',
  },
];

let finalizationPassed = 0;
for (const testCase of finalizationCases) {
  const actual = chooseFinalOutput(testCase.input);
  const ok = actual === testCase.expected;
  if (ok) {
    finalizationPassed += 1;
    console.log(`PASS: ${testCase.name}`);
  } else {
    console.log(`FAIL: ${testCase.name}`);
    console.log(`  expected: ${JSON.stringify(testCase.expected)}`);
    console.log(`  actual:   ${JSON.stringify(actual)}`);
  }
}

console.log(`\n${finalizationPassed}/${finalizationCases.length} finalization tests passed.`);

if (finalizationPassed !== finalizationCases.length) {
  process.exitCode = 1;
}

console.log('\nStreaming merge regression tests');

const streamingCases = [
  {
    name: 'content stays hidden until think closes',
    run: () => {
      const combine = createStreamCombiner({ reasoning: true });
      const out1 = combine({ reasoning_content: 'Thinking one', token: 'Thinking one' });
      const out2 = combine({ content: 'Hi there' });
      return [out1, out2];
    },
    expected: ['<think>Thinking one</think>', '<think>Thinking one</think>'],
  },
  {
    name: 'split accumulated_text into thought + response',
    run: () => {
      const combine = createStreamCombiner({ reasoning: true });
      const out = combine({ accumulated_text: '<think>trace</think>Answer' });
      return [out];
    },
    expected: ['<think>trace</think>Answer'],
  },
  {
    name: 'token-only reasoning text with tags should stay in thought',
    run: () => {
      const combine = createStreamCombiner({ reasoning: true });
      const out1 = combine({ token: '<think>trace part</think>' });
      const out2 = combine({ token: ' answer' });
      return [out1, out2];
    },
    expected: ['<think>trace part</think>', '<think>trace part</think>answer'],
  },
  {
    name: 'content chunk does not leak into response before closing think',
    run: () => {
      const combine = createStreamCombiner({ reasoning: true });
      const out1 = combine({ token: 'step one' });
      const out2 = combine({ content: 'step one' });
      const out3 = combine({ token: '</think>Final answer' });
      return [out1, out2, out3];
    },
    expected: [
      '<think>step one</think>',
      '<think>step one</think>',
      '<think>step one</think>Final answer',
    ],
  },
];

let streamingPassed = 0;
for (const testCase of streamingCases) {
  const actual = testCase.run();
  const ok = JSON.stringify(actual) === JSON.stringify(testCase.expected);
  if (ok) {
    streamingPassed += 1;
    console.log(`PASS: ${testCase.name}`);
  } else {
    console.log(`FAIL: ${testCase.name}`);
    console.log(`  expected: ${JSON.stringify(testCase.expected)}`);
    console.log(`  actual:   ${JSON.stringify(actual)}`);
  }
}

console.log(`\n${streamingPassed}/${streamingCases.length} streaming tests passed.`);

if (streamingPassed !== streamingCases.length) {
  process.exitCode = 1;
}

console.log('\nFallback content preservation tests');

const fallbackContentCases = [
  {
    name: 'preserve completed reasoning while retry response streams',
    input: {
      existingContent: '<think>trace only</think>',
      nextContent: 'Answer',
    },
    expected: '<think>trace only</think>Answer',
  },
  {
    name: 'keep newer reasoning if next content already includes think tags',
    input: {
      existingContent: '<think>older trace</think>',
      nextContent: '<think>new trace</think>Answer',
    },
    expected: '<think>new trace</think>Answer',
  },
  {
    name: 'empty next content keeps preserved reasoning only',
    input: {
      existingContent: '<think>trace only</think>',
      nextContent: '',
    },
    expected: '<think>trace only</think>',
  },
];

let fallbackContentPassed = 0;
for (const testCase of fallbackContentCases) {
  const actual = mergeReasoningIntoContent(
    testCase.input.existingContent,
    testCase.input.nextContent,
  );
  const ok = actual === testCase.expected;
  if (ok) {
    fallbackContentPassed += 1;
    console.log(`PASS: ${testCase.name}`);
  } else {
    console.log(`FAIL: ${testCase.name}`);
    console.log(`  expected: ${JSON.stringify(testCase.expected)}`);
    console.log(`  actual:   ${JSON.stringify(actual)}`);
  }
}

console.log(`\n${fallbackContentPassed}/${fallbackContentCases.length} fallback content tests passed.`);

if (fallbackContentPassed !== fallbackContentCases.length) {
  process.exitCode = 1;
}

console.log('\nFallback decision tests');

const fallbackCases = [
  {
    name: 'fallback when reasoning reaches cap with no response',
    input: {
      reasoningEnabled: true,
      isVisionRequest: false,
      manualStopRequested: false,
      reasoningTokenCount: 1000,
      maxReasoningTokens: 1000,
      responseContent: '',
      reasoningContent: 'trace',
    },
    expected: true,
  },
  {
    name: 'no fallback once response has started',
    input: {
      reasoningEnabled: true,
      isVisionRequest: false,
      manualStopRequested: false,
      reasoningTokenCount: 1000,
      maxReasoningTokens: 1000,
      responseContent: 'Answer',
      reasoningContent: 'trace',
    },
    expected: false,
  },
  {
    name: 'fallback on reasoning-only completion below cap',
    input: {
      reasoningEnabled: true,
      isVisionRequest: false,
      manualStopRequested: false,
      reasoningTokenCount: 321,
      maxReasoningTokens: 1000,
      responseContent: '',
      reasoningContent: 'trace only',
    },
    expected: true,
  },
  {
    name: 'manual stop suppresses fallback',
    input: {
      reasoningEnabled: true,
      isVisionRequest: false,
      manualStopRequested: true,
      reasoningTokenCount: 1000,
      maxReasoningTokens: 1000,
      responseContent: '',
      reasoningContent: 'trace only',
    },
    expected: false,
  },
  {
    name: 'vision requests never fallback',
    input: {
      reasoningEnabled: true,
      isVisionRequest: true,
      manualStopRequested: false,
      reasoningTokenCount: 1000,
      maxReasoningTokens: 1000,
      responseContent: '',
      reasoningContent: 'trace only',
    },
    expected: false,
  },
];

let fallbackPassed = 0;
for (const testCase of fallbackCases) {
  const actual = shouldFallbackToNonThinking(testCase.input);
  const ok = actual === testCase.expected;
  if (ok) {
    fallbackPassed += 1;
    console.log(`PASS: ${testCase.name}`);
  } else {
    console.log(`FAIL: ${testCase.name}`);
    console.log(`  expected: ${JSON.stringify(testCase.expected)}`);
    console.log(`  actual:   ${JSON.stringify(actual)}`);
  }
}

console.log(`\n${fallbackPassed}/${fallbackCases.length} fallback tests passed.`);

if (fallbackPassed !== fallbackCases.length) {
  process.exitCode = 1;
}
