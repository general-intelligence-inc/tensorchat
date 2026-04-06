type FenceMarker = '```' | '~~~';

export type MarkdownLatexSegment =
  | {
      type: 'markdown';
      content: string;
    }
  | {
      type: 'latex-block';
      content: string;
    };

export type MarkdownRenderSegment =
  | MarkdownLatexSegment
  | {
      type: 'code-block';
      content: string;
      language: string | null;
    };

const INLINE_LATEX_IDENTIFIER_PATTERN = /^(?:[A-Za-z]|[a-z]{2,3}|sin|cos|tan|cot|sec|csc|log|ln|max|min|lim|arg|det|dim|gcd|lcm|exp|ker|deg|pi|phi|psi|rho|eta|theta|lambda|sigma|tau|omega)$/;

function isWhitespaceCharacter(character: string | undefined): boolean {
  return character === ' ' || character === '\t' || character === '\n' || character === '\r';
}

function isAlphaNumericCharacter(character: string | undefined): boolean {
  return character !== undefined && /[0-9A-Za-z]/.test(character);
}

function getBacktickRunLength(source: string, index: number): number {
  if (source[index] !== '`') {
    return 0;
  }

  let cursor = index;

  while (cursor < source.length && source[cursor] === '`') {
    cursor += 1;
  }

  return cursor - index;
}

function isPureNumericAmount(text: string): boolean {
  return /^[+-]?\d[\d,]*(?:\.\d+)?%?$/.test(text);
}

function isNumericMathExpression(text: string): boolean {
  return /^[+-]?\d[\d,]*(?:\.\d+)?(?:\s*[+\-*/=]\s*[+-]?\d[\d,]*(?:\.\d+)?)+$/.test(text);
}

function isProbablyInlineLatex(text: string): boolean {
  const trimmed = text.trim();

  if (trimmed.length === 0 || /\r|\n/.test(trimmed)) {
    return false;
  }

  if (isPureNumericAmount(trimmed)) {
    return false;
  }

  if (isNumericMathExpression(trimmed)) {
    return true;
  }

  if (/\\[A-Za-z]+/.test(trimmed)) {
    return true;
  }

  if (/[{}_^]/.test(trimmed)) {
    return true;
  }

  if (/[=<>±∑∏∞]/.test(trimmed)) {
    return true;
  }

  if (/[A-Za-z]/.test(trimmed) && /[0-9]/.test(trimmed)) {
    return true;
  }

  if (/[()\[\]]/.test(trimmed) && /[A-Za-z]/.test(trimmed)) {
    return true;
  }

  if (/[+\-*/]/.test(trimmed)) {
    return !/^[+\-*/=]/.test(trimmed) && !/[+\-*/=]$/.test(trimmed);
  }

  if (/^[A-Za-z]+$/.test(trimmed)) {
    return INLINE_LATEX_IDENTIFIER_PATTERN.test(trimmed);
  }

  return false;
}

function findInlineLatexClose(source: string, startIndex: number, endIndex: number): number {
  let cursor = startIndex;

  while (cursor < endIndex) {
    if (source[cursor] === '\n' || source[cursor] === '\r') {
      return -1;
    }

    if (
      source[cursor] === '$'
      && source[cursor + 1] !== '$'
      && !isEscapedDelimiter(source, cursor)
      && !isWhitespaceCharacter(source[cursor - 1])
    ) {
      return cursor;
    }

    cursor += 1;
  }

  return -1;
}

function isEscapedDelimiter(source: string, index: number): boolean {
  let backslashCount = 0;

  for (let cursor = index - 1; cursor >= 0 && source[cursor] === '\\'; cursor -= 1) {
    backslashCount += 1;
  }

  return backslashCount % 2 === 1;
}

function getFenceMarkerAtIndex(source: string, index: number): FenceMarker | null {
  const marker = source.startsWith('```', index)
    ? '```'
    : source.startsWith('~~~', index)
      ? '~~~'
      : null;

  if (marker === null) {
    return null;
  }

  const lineStart = source.lastIndexOf('\n', index - 1) + 1;
  const indentation = source.slice(lineStart, index);

  if (!/^[ \t]{0,3}$/.test(indentation)) {
    return null;
  }

  return marker;
}

function findLatexBlockEnd(source: string, startIndex: number): number {
  let cursor = startIndex;
  let activeFence: FenceMarker | null = null;
  let activeInlineCodeLength: number | null = null;

  while (cursor < source.length) {
    const fenceMarker = getFenceMarkerAtIndex(source, cursor);

    if (fenceMarker !== null) {
      if (activeFence === null) {
        activeFence = fenceMarker;
      } else if (activeFence === fenceMarker) {
        activeFence = null;
      }

      cursor += fenceMarker.length;
      continue;
    }

    if (activeFence === null) {
      const backtickRunLength = getBacktickRunLength(source, cursor);

      if (backtickRunLength > 0) {
        if (activeInlineCodeLength === null) {
          activeInlineCodeLength = backtickRunLength;
        } else if (activeInlineCodeLength === backtickRunLength) {
          activeInlineCodeLength = null;
        }

        cursor += backtickRunLength;
        continue;
      }
    }

    if (
      activeFence === null
      && activeInlineCodeLength === null
      && source.startsWith('$$', cursor)
      && !isEscapedDelimiter(source, cursor)
    ) {
      return cursor;
    }

    cursor += 1;
  }

  return -1;
}

function pushMarkdownSegment(segments: MarkdownLatexSegment[], content: string): void {
  if (content.length === 0) {
    return;
  }

  const previousSegment = segments[segments.length - 1];

  if (previousSegment?.type === 'markdown') {
    previousSegment.content += content;
    return;
  }

  segments.push({ type: 'markdown', content });
}

function splitMarkdownWithLatexBlocks(source: string): MarkdownLatexSegment[] {
  const segments: MarkdownLatexSegment[] = [];
  let cursor = 0;
  let markdownStart = 0;
  let activeFence: FenceMarker | null = null;
  let activeInlineCodeLength: number | null = null;

  while (cursor < source.length) {
    const fenceMarker = getFenceMarkerAtIndex(source, cursor);

    if (fenceMarker !== null) {
      if (activeFence === null) {
        activeFence = fenceMarker;
      } else if (activeFence === fenceMarker) {
        activeFence = null;
      }

      cursor += fenceMarker.length;
      continue;
    }

    if (activeFence === null) {
      const backtickRunLength = getBacktickRunLength(source, cursor);

      if (backtickRunLength > 0) {
        if (activeInlineCodeLength === null) {
          activeInlineCodeLength = backtickRunLength;
        } else if (activeInlineCodeLength === backtickRunLength) {
          activeInlineCodeLength = null;
        }

        cursor += backtickRunLength;
        continue;
      }
    }

    if (
      activeFence === null
      && activeInlineCodeLength === null
      && source.startsWith('$$', cursor)
      && !isEscapedDelimiter(source, cursor)
    ) {
      const closingIndex = findLatexBlockEnd(source, cursor + 2);

      if (closingIndex === -1) {
        break;
      }

      pushMarkdownSegment(segments, source.slice(markdownStart, cursor));

      const latexContent = source.slice(cursor + 2, closingIndex).trim();

      if (latexContent.length > 0) {
        segments.push({ type: 'latex-block', content: latexContent });
      } else {
        pushMarkdownSegment(segments, source.slice(cursor, closingIndex + 2));
      }

      cursor = closingIndex + 2;
      markdownStart = cursor;
      continue;
    }

    cursor += 1;
  }

  pushMarkdownSegment(segments, source.slice(markdownStart));
  return segments;
}

export function splitMarkdownForNativeLatex(source: string): MarkdownLatexSegment[] {
  if (source.length === 0) {
    return [];
  }

  return splitMarkdownWithLatexBlocks(source).map((segment) => {
    if (segment.type === 'markdown') {
      return {
        type: 'markdown',
        content: prepareInlineLatexCandidates(segment.content),
      };
    }

    return segment;
  });
}

interface FenceStart {
  markerCharacter: '`' | '~';
  markerLength: number;
  language: string | null;
}

function getSourceLines(source: string): string[] {
  return source.match(/[^\n]*\n|[^\n]+/g) ?? [];
}

function parseFenceStart(line: string): FenceStart | null {
  const match = line.match(/^[ \t]{0,3}(([`~])\2{2,})(.*)$/);

  if (!match) {
    return null;
  }

  const marker = match[1];
  const markerCharacter = match[2] as '`' | '~';
  const infoString = match[3].trim();
  const languageToken = infoString.length > 0 ? infoString.split(/[\s{]/, 1)[0] : '';

  return {
    markerCharacter,
    markerLength: marker.length,
    language: languageToken.length > 0 ? languageToken : null,
  };
}

function isFenceClose(line: string, fenceStart: FenceStart): boolean {
  const trimmedLine = line.replace(/^[ \t]{0,3}/, '');

  if (trimmedLine.length < fenceStart.markerLength) {
    return false;
  }

  let cursor = 0;

  while (cursor < trimmedLine.length && trimmedLine[cursor] === fenceStart.markerCharacter) {
    cursor += 1;
  }

  if (cursor < fenceStart.markerLength) {
    return false;
  }

  return /^[ \t]*$/.test(trimmedLine.slice(cursor));
}

function pushRenderSegment(segments: MarkdownRenderSegment[], segment: MarkdownRenderSegment): void {
  if (segment.type === 'markdown' && segment.content.length === 0) {
    return;
  }

  const previousSegment = segments[segments.length - 1];

  if (segment.type === 'markdown' && previousSegment?.type === 'markdown') {
    previousSegment.content += segment.content;
    return;
  }

  segments.push(segment);
}

function pushMarkdownRenderSegments(segments: MarkdownRenderSegment[], content: string): void {
  if (content.length === 0) {
    return;
  }

  splitMarkdownForNativeLatex(content).forEach((segment) => {
    pushRenderSegment(segments, segment);
  });
}

export function splitMarkdownForRendering(source: string): MarkdownRenderSegment[] {
  if (source.length === 0) {
    return [];
  }

  const segments: MarkdownRenderSegment[] = [];
  const sourceLines = getSourceLines(source);

  let markdownBuffer = '';
  let codeBuffer = '';
  let openingFenceLine = '';
  let activeFence: FenceStart | null = null;

  sourceLines.forEach((lineWithEnding) => {
    const line = lineWithEnding.endsWith('\n') ? lineWithEnding.slice(0, -1) : lineWithEnding;

    if (activeFence === null) {
      const fenceStart = parseFenceStart(line);

      if (fenceStart === null) {
        markdownBuffer += lineWithEnding;
        return;
      }

      pushMarkdownRenderSegments(segments, markdownBuffer);
      markdownBuffer = '';
      codeBuffer = '';
      openingFenceLine = lineWithEnding;
      activeFence = fenceStart;
      return;
    }

    if (isFenceClose(line, activeFence)) {
      pushRenderSegment(segments, {
        type: 'code-block',
        content: codeBuffer,
        language: activeFence.language,
      });
      codeBuffer = '';
      openingFenceLine = '';
      activeFence = null;
      return;
    }

    codeBuffer += lineWithEnding;
  });

  if (activeFence !== null) {
    markdownBuffer += `${openingFenceLine}${codeBuffer}`;
  }

  pushMarkdownRenderSegments(segments, markdownBuffer);
  return segments;
}

function prepareInlineLatexCandidates(source: string): string {
  if (source.length === 0) {
    return source;
  }

  let output = '';
  let cursor = 0;
  let activeFence: FenceMarker | null = null;
  let activeInlineCodeLength: number | null = null;

  while (cursor < source.length) {
    const fenceMarker = getFenceMarkerAtIndex(source, cursor);

    if (fenceMarker !== null) {
      if (activeFence === null) {
        activeFence = fenceMarker;
      } else if (activeFence === fenceMarker) {
        activeFence = null;
      }

      output += fenceMarker;
      cursor += fenceMarker.length;
      continue;
    }

    if (activeFence === null) {
      const backtickRunLength = getBacktickRunLength(source, cursor);

      if (backtickRunLength > 0) {
        if (activeInlineCodeLength === null) {
          activeInlineCodeLength = backtickRunLength;
        } else if (activeInlineCodeLength === backtickRunLength) {
          activeInlineCodeLength = null;
        }

        output += source.slice(cursor, cursor + backtickRunLength);
        cursor += backtickRunLength;
        continue;
      }
    }

    if (
      activeFence === null
      && activeInlineCodeLength === null
      && source[cursor] === '$'
      && source[cursor + 1] !== '$'
      && !isEscapedDelimiter(source, cursor)
    ) {
      const previousCharacter = cursor > 0 ? source[cursor - 1] : undefined;
      const nextCharacter = source[cursor + 1];

      if (
        nextCharacter === undefined
        || isWhitespaceCharacter(nextCharacter)
        || isAlphaNumericCharacter(previousCharacter)
      ) {
        output += '\\$';
        cursor += 1;
        continue;
      }

      const closeIndex = findInlineLatexClose(source, cursor + 1, source.length);

      if (closeIndex === -1) {
        output += '\\$';
        cursor += 1;
        continue;
      }

      const content = source.slice(cursor + 1, closeIndex);

      if (!isProbablyInlineLatex(content)) {
        output += `\\$${content}\\$`;
        cursor = closeIndex + 1;
        continue;
      }

      output += source.slice(cursor, closeIndex + 1);
      cursor = closeIndex + 1;
      continue;
    }

    output += source[cursor];
    cursor += 1;
  }

  return output;
}

function ensureLeadingBlankLine(output: string): string {
  if (output.length === 0) {
    return output;
  }

  if (output.endsWith('\n\n')) {
    return output;
  }

  if (output.endsWith('\n')) {
    return `${output}\n`;
  }

  return `${output}\n\n`;
}

function ensureLeadingBlankLineForContent(content: string): string {
  if (content.length === 0) {
    return content;
  }

  if (content.startsWith('\n\n')) {
    return content;
  }

  if (content.startsWith('\n')) {
    return `\n${content}`;
  }

  return `\n\n${content}`;
}

export function prepareMarkdownForNativeLatex(source: string): string {
  if (source.length === 0) {
    return source;
  }

  const segments = splitMarkdownForNativeLatex(source);
  let output = '';

  segments.forEach((segment, index) => {
    if (segment.type === 'markdown') {
      output += index > 0 && segments[index - 1]?.type === 'latex-block'
        ? ensureLeadingBlankLineForContent(segment.content)
        : segment.content;
      return;
    }

    output = ensureLeadingBlankLine(output);
    output += `$$\n${segment.content}\n$$`;
  });

  if (segments.length === 0) {
    return prepareInlineLatexCandidates(source);
  }

  return output;
}