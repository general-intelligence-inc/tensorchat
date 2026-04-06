import { optionalRequire } from './optionalRequire';

export interface KokoroPhonemizerResult {
  segments: string[];
  phonemes: string;
  unsupportedCharacters: string[];
}

interface NativePhonemizerModuleLike {
  phonemize: (text: string, locale?: string) => Promise<string>;
  isAvailable?: boolean;
}

export interface KokoroUtteranceSplitOptions {
  firstUtteranceTargetChars?: number;
  targetUtteranceChars?: number;
  minUtteranceChars?: number;
  maxUtteranceChars?: number;
  maxSentencesPerUtterance?: number;
}

const KOKORO_SENTENCE_END_CHARACTERS = new Set(['.', '!', '?', '…']);
const KOKORO_SENTENCE_TRAILING_CHARACTERS = new Set(['"', '\'', ')', ']', '}', '”', '’']);
const KOKORO_NON_TERMINAL_ABBREVIATIONS = new Set([
  'mr.',
  'mrs.',
  'ms.',
  'dr.',
  'prof.',
  'sr.',
  'jr.',
  'st.',
  'vs.',
  'etc.',
  'e.g.',
  'i.e.',
  'a.m.',
  'p.m.',
]);

const KOKORO_SUPPORTED_CHARACTERS = new Set(
  Array.from(';:,.!?—…"() “” ̃ʣʥʦʨᵝꭧAIOQSTWYᵊabcdefghijklmnopqrstuvwxyzɑɐɒæβɔɕçɖðʤəɚɛɜɟɡɥɨɪʝɯɰŋɳɲɴøɸθœɹɾɻʁɽʂʃʈʧʊʋʌɣɤχʎʒʔˈˌːʰʲ↓→↗↘ᵻ'),
);

const KOKORO_SUBSTITUTIONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\u200d/g, ''],
  [/\r\n?/g, '\n'],
  [/ɫ/g, 'l'],
  [/ɝ/g, 'ɜɹ'],
  [/r/g, 'ɹ'],
  [/g/g, 'ɡ'],
];

let nativePhonemizerModule: NativePhonemizerModuleLike | null = null;
let nativePhonemizerLoadError: Error | null = null;

function normalizePhonemizerLoadError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);

  if (
    message.includes("Creating blobs from 'ArrayBuffer' and 'ArrayBufferView' are not supported")
    || message.toLowerCase().includes('decompressionstream')
  ) {
    return new Error('Kokoro phonemizer is not supported by this React Native runtime.');
  }

  return new Error(`Unable to load Kokoro phonemizer: ${message}`);
}

function getNativePhonemizerExport(moduleExports: unknown): NativePhonemizerModuleLike | null {
  if (!moduleExports || typeof moduleExports !== 'object') {
    return null;
  }

  const moduleRecord = moduleExports as {
    phonemize?: unknown;
    isAvailable?: unknown;
    default?: {
      phonemize?: unknown;
      isAvailable?: unknown;
    };
  };

  if (typeof moduleRecord.phonemize === 'function') {
    return {
      phonemize: moduleRecord.phonemize as NativePhonemizerModuleLike['phonemize'],
      isAvailable: typeof moduleRecord.isAvailable === 'boolean' ? moduleRecord.isAvailable : undefined,
    };
  }

  if (typeof moduleRecord.default?.phonemize === 'function') {
    return {
      phonemize: moduleRecord.default.phonemize as NativePhonemizerModuleLike['phonemize'],
      isAvailable: typeof moduleRecord.default.isAvailable === 'boolean' ? moduleRecord.default.isAvailable : undefined,
    };
  }

  return null;
}

function loadNativePhonemizerModule(): NativePhonemizerModuleLike {
  if (nativePhonemizerModule) {
    return nativePhonemizerModule;
  }

  if (nativePhonemizerLoadError) {
    throw nativePhonemizerLoadError;
  }

  try {
    const moduleExports = optionalRequire<unknown>(() => require('react-native-phonemis'));

    if (!moduleExports) {
      throw new Error('Missing linked native Phonemis module.');
    }

    const nativeModule = getNativePhonemizerExport(moduleExports);

    if (!nativeModule || nativeModule.isAvailable === false) {
      throw new Error('Missing linked native Phonemis module.');
    }

    nativePhonemizerModule = nativeModule;
    return nativePhonemizerModule;
  } catch (error) {
    nativePhonemizerLoadError = normalizePhonemizerLoadError(error);
    throw nativePhonemizerLoadError;
  }
}

export function isKokoroPhonemizerSupportedRuntime(): boolean {
  try {
    return loadNativePhonemizerModule().isAvailable !== false;
  } catch {
    return false;
  }
}

export async function ensureKokoroPhonemizerReady(): Promise<void> {
  loadNativePhonemizerModule();
}

function normalizeKokoroWhitespace(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(/ ?([,.;:!?])/g, '$1')
    .trim();
}

export function normalizeKokoroPhonemes(phonemeText: string): string {
  let normalized = phonemeText;

  for (const [pattern, replacement] of KOKORO_SUBSTITUTIONS) {
    normalized = normalized.replace(pattern, replacement);
  }

  return normalizeKokoroWhitespace(normalized);
}

export function getUnsupportedKokoroCharacters(phonemeText: string): string[] {
  const unsupported = new Set<string>();

  for (const character of Array.from(phonemeText)) {
    if (character === '\n' || KOKORO_SUPPORTED_CHARACTERS.has(character)) {
      continue;
    }

    unsupported.add(character);
  }

  return Array.from(unsupported).sort();
}

function isLikelyKokoroSentenceBoundary(
  characters: string[],
  index: number,
  currentSentence: string,
): boolean {
  const character = characters[index];

  if (character === '\n') {
    return true;
  }

  if (!KOKORO_SENTENCE_END_CHARACTERS.has(character)) {
    return false;
  }

  const trimmedSentence = currentSentence.trimEnd().toLowerCase();
  let lookaheadIndex = index + 1;
  let skippedWhitespace = false;

  while (
    lookaheadIndex < characters.length
    && KOKORO_SENTENCE_TRAILING_CHARACTERS.has(characters[lookaheadIndex])
  ) {
    lookaheadIndex += 1;
  }

  while (lookaheadIndex < characters.length && /\s/u.test(characters[lookaheadIndex])) {
    skippedWhitespace = true;
    lookaheadIndex += 1;
  }

  const nextNonWhitespaceCharacter = lookaheadIndex < characters.length
    ? characters[lookaheadIndex]
    : null;

  if (
    character === '.'
    && nextNonWhitespaceCharacter
    && /\d/u.test(nextNonWhitespaceCharacter)
    && /\d\.$/u.test(trimmedSentence)
  ) {
    return false;
  }

  for (const abbreviation of KOKORO_NON_TERMINAL_ABBREVIATIONS) {
    if (trimmedSentence.endsWith(abbreviation) && nextNonWhitespaceCharacter) {
      return false;
    }
  }

  return lookaheadIndex >= characters.length || skippedWhitespace;
}

export function splitTextIntoKokoroSentences(text: string): string[] {
  const normalizedText = text.replace(/\r\n?/g, '\n').trim();

  if (!normalizedText) {
    return [];
  }

  const characters = Array.from(normalizedText);
  const sentences: string[] = [];
  let currentSentence = '';

  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    currentSentence += character;

    if (character === '\n') {
      const sentence = currentSentence.trim();
      currentSentence = '';

      if (sentence) {
        sentences.push(sentence);
      }

      continue;
    }

    if (!isLikelyKokoroSentenceBoundary(characters, index, currentSentence)) {
      continue;
    }

    let trailingIndex = index + 1;

    while (
      trailingIndex < characters.length
      && KOKORO_SENTENCE_TRAILING_CHARACTERS.has(characters[trailingIndex])
    ) {
      currentSentence += characters[trailingIndex];
      trailingIndex += 1;
    }

    const sentence = currentSentence.trim();
    currentSentence = '';

    if (sentence) {
      sentences.push(sentence);
    }

    while (trailingIndex < characters.length && /\s/u.test(characters[trailingIndex])) {
      if (characters[trailingIndex] === '\n') {
        break;
      }

      trailingIndex += 1;
    }

    index = trailingIndex - 1;
  }

  const trailingSentence = currentSentence.trim();

  if (trailingSentence) {
    sentences.push(trailingSentence);
  }

  return sentences;
}

export function splitTextIntoKokoroUtterances(
  text: string,
  options?: KokoroUtteranceSplitOptions,
): string[] {
  const sentences = splitTextIntoKokoroSentences(text);

  if (sentences.length === 0) {
    return [];
  }

  const firstUtteranceTargetChars = Math.max(1, options?.firstUtteranceTargetChars ?? 140);
  const targetUtteranceChars = Math.max(firstUtteranceTargetChars, options?.targetUtteranceChars ?? 260);
  const minUtteranceChars = Math.max(1, Math.min(options?.minUtteranceChars ?? 48, targetUtteranceChars));
  const maxUtteranceChars = Math.max(targetUtteranceChars, options?.maxUtteranceChars ?? 320);
  const maxSentencesPerUtterance = Math.max(1, options?.maxSentencesPerUtterance ?? 3);
  const utterances: string[] = [];
  let currentSentences: string[] = [];
  let currentLength = 0;

  const flushCurrentUtterance = () => {
    if (currentSentences.length === 0) {
      return;
    }

    utterances.push(currentSentences.join(' '));
    currentSentences = [];
    currentLength = 0;
  };

  for (const sentence of sentences) {
    const trimmedSentence = sentence.trim();

    if (!trimmedSentence) {
      continue;
    }

    if (currentSentences.length === 0) {
      currentSentences = [trimmedSentence];
      currentLength = trimmedSentence.length;
      continue;
    }

    const currentTargetChars = utterances.length === 0
      ? firstUtteranceTargetChars
      : targetUtteranceChars;
    const candidateLength = currentLength + 1 + trimmedSentence.length;
    const shouldGrowToMinimum = currentLength < minUtteranceChars && candidateLength <= maxUtteranceChars;
    const shouldGrowToTarget = currentLength < currentTargetChars
      && candidateLength <= currentTargetChars
      && currentSentences.length < maxSentencesPerUtterance;

    if (
      (shouldGrowToMinimum || shouldGrowToTarget)
      && candidateLength <= maxUtteranceChars
      && currentSentences.length < maxSentencesPerUtterance
    ) {
      currentSentences.push(trimmedSentence);
      currentLength = candidateLength;
      continue;
    }

    flushCurrentUtterance();
    currentSentences = [trimmedSentence];
    currentLength = trimmedSentence.length;
  }

  flushCurrentUtterance();

  return utterances;
}

export async function phonemizeForKokoro(
  text: string,
  language: string = 'en-us',
): Promise<KokoroPhonemizerResult> {
  const { phonemize } = loadNativePhonemizerModule();
  const phonemes = normalizeKokoroPhonemes(await phonemize(text, language));

  return {
    segments: phonemes.length > 0 ? [phonemes] : [],
    phonemes,
    unsupportedCharacters: getUnsupportedKokoroCharacters(phonemes),
  };
}
