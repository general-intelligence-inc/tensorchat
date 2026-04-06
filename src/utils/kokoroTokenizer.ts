export interface KokoroTokenizerDefinition {
  model?: {
    vocab?: Record<string, number>;
  };
}

export interface KokoroTokenChunk {
  phonemes: string;
  tokenIds: number[];
}

interface KokoroChunkingOptions {
  firstChunkMaxTokens?: number;
}

const KOKORO_STRONG_BREAK_CHARACTERS = new Set([',', '.', '!', '?', ';', ':', '—', '…']);
const KOKORO_WEAK_BREAK_CHARACTERS = new Set([' ']);

function findKokoroBreakBefore(
  characters: string[],
  start: number,
  end: number,
  breakCharacters: ReadonlySet<string>,
): number | null {
  for (let cursor = end; cursor > start; cursor -= 1) {
    if (breakCharacters.has(characters[cursor - 1])) {
      return cursor;
    }
  }

  return null;
}

function findKokoroBreakAfter(
  characters: string[],
  start: number,
  end: number,
  breakCharacters: ReadonlySet<string>,
): number | null {
  for (let cursor = start; cursor <= end; cursor += 1) {
    if (cursor === characters.length || breakCharacters.has(characters[cursor - 1])) {
      return cursor;
    }
  }

  return null;
}

export function parseKokoroTokenizer(jsonText: string): Record<string, number> {
  const parsed = JSON.parse(jsonText) as KokoroTokenizerDefinition;
  const vocab = parsed.model?.vocab;

  if (!vocab) {
    throw new Error('Kokoro tokenizer is missing its vocab map.');
  }

  return vocab;
}

export function encodeKokoroPhonemes(
  phonemeText: string,
  vocab: Record<string, number>,
): { tokenIds: number[]; unsupportedCharacters: string[] } {
  const tokenIds: number[] = [];
  const unsupportedCharacters = new Set<string>();

  for (const character of Array.from(phonemeText)) {
    const tokenId = vocab[character];

    if (tokenId === undefined) {
      unsupportedCharacters.add(character);
      continue;
    }

    tokenIds.push(tokenId);
  }

  return {
    tokenIds,
    unsupportedCharacters: Array.from(unsupportedCharacters).sort(),
  };
}

export function splitKokoroPhonemes(
  phonemeText: string,
  maxTokens: number,
  options?: KokoroChunkingOptions,
): string[] {
  const trimmed = phonemeText.trim();

  if (!trimmed) {
    return [];
  }

  const characters = Array.from(trimmed);
  const chunks: string[] = [];
  const firstChunkMaxTokens = options?.firstChunkMaxTokens
    ? Math.max(1, Math.min(options.firstChunkMaxTokens, maxTokens))
    : null;
  let start = 0;

  while (start < characters.length) {
    const currentMaxTokens = chunks.length === 0 && firstChunkMaxTokens
      ? firstChunkMaxTokens
      : maxTokens;
    const preferredEnd = Math.min(start + currentMaxTokens, characters.length);
    const hardEnd = Math.min(start + maxTokens, characters.length);
    let end = preferredEnd;
    let foundBreak = false;

    if (preferredEnd < characters.length) {
      const strongBreakBeforePreferredEnd = findKokoroBreakBefore(
        characters,
        start,
        preferredEnd,
        KOKORO_STRONG_BREAK_CHARACTERS,
      );

      if (strongBreakBeforePreferredEnd !== null) {
        end = strongBreakBeforePreferredEnd;
        foundBreak = true;
      }

      if (!foundBreak && currentMaxTokens !== maxTokens) {
        const strongBreakAfterPreferredEnd = findKokoroBreakAfter(
          characters,
          preferredEnd + 1,
          hardEnd,
          KOKORO_STRONG_BREAK_CHARACTERS,
        );

        if (strongBreakAfterPreferredEnd !== null) {
          end = strongBreakAfterPreferredEnd;
          foundBreak = true;
        }
      }

      if (!foundBreak) {
        const weakBreakBeforePreferredEnd = findKokoroBreakBefore(
          characters,
          start,
          preferredEnd,
          KOKORO_WEAK_BREAK_CHARACTERS,
        );

        if (weakBreakBeforePreferredEnd !== null) {
          end = weakBreakBeforePreferredEnd;
          foundBreak = true;
        }
      }

      if (!foundBreak && currentMaxTokens !== maxTokens) {
        const weakBreakAfterPreferredEnd = findKokoroBreakAfter(
          characters,
          preferredEnd + 1,
          hardEnd,
          KOKORO_WEAK_BREAK_CHARACTERS,
        );

        if (weakBreakAfterPreferredEnd !== null) {
          end = weakBreakAfterPreferredEnd;
          foundBreak = true;
        }
      }

      if (!foundBreak) {
        const strongBreakBeforeHardEnd = findKokoroBreakBefore(
          characters,
          start,
          hardEnd,
          KOKORO_STRONG_BREAK_CHARACTERS,
        ) ?? findKokoroBreakBefore(
          characters,
          start,
          hardEnd,
          KOKORO_WEAK_BREAK_CHARACTERS,
        );

        if (strongBreakBeforeHardEnd !== null) {
          end = strongBreakBeforeHardEnd;
          foundBreak = true;
        }
      }

      if (!foundBreak) {
        throw new Error(`Kokoro phoneme chunk would split in the middle of a word before ${maxTokens} tokens.`);
      }
    }

    const chunk = characters.slice(start, end).join('').trim();
    start = end;

    if (!chunk) {
      continue;
    }

    if (Array.from(chunk).length > maxTokens) {
      throw new Error(`Kokoro phoneme chunk exceeds ${maxTokens} tokens.`);
    }

    chunks.push(chunk);
  }

  return chunks;
}

export function encodeKokoroPhonemeChunks(
  phonemeText: string,
  vocab: Record<string, number>,
  maxTokens: number,
  options?: KokoroChunkingOptions,
): { chunks: KokoroTokenChunk[]; unsupportedCharacters: string[] } {
  const phonemeChunks = splitKokoroPhonemes(phonemeText, maxTokens, options);
  const unsupportedCharacters = new Set<string>();
  const chunks: KokoroTokenChunk[] = [];

  for (const chunk of phonemeChunks) {
    const encoded = encodeKokoroPhonemes(chunk, vocab);

    encoded.unsupportedCharacters.forEach((character) => unsupportedCharacters.add(character));

    chunks.push({
      phonemes: chunk,
      tokenIds: encoded.tokenIds,
    });
  }

  return {
    chunks,
    unsupportedCharacters: Array.from(unsupportedCharacters).sort(),
  };
}