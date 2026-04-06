export const TTS_NON_ENGLISH_ADVISORY = 'English voice only. This message includes non-English text.';

const EMOJI_REGEX = /[\u{1F000}-\u{1FFFF}]|[\u{2600}-\u{27BF}]|[\u{FE00}-\u{FEFF}]/gu;
const NON_SPEECH_SYMBOL_REGEX = /[^a-zA-Z0-9\u00C0-\u024F\s.,!?:;'"()\-\n]/g;
const LATIN_LETTER_REGEX = /[A-Za-z\u00C0-\u024F]/g;
const ACCENTED_LATIN_REGEX = /[\u00C0-\u024F]/g;
const INVERTED_PUNCTUATION_REGEX = /[¿¡]/g;
const LATIN_WORD_REGEX = /[A-Za-z\u00C0-\u024F]+(?:['’-][A-Za-z\u00C0-\u024F]+)*/g;

const ENGLISH_SIGNAL_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'but',
  'by',
  'for',
  'from',
  'he',
  'her',
  'his',
  'i',
  'in',
  'is',
  'it',
  'its',
  'of',
  'on',
  'or',
  'our',
  'she',
  'that',
  'the',
  'their',
  'they',
  'this',
  'to',
  'was',
  'we',
  'were',
  'with',
  'you',
  'your',
]);

const NON_ENGLISH_SIGNAL_WORDS = new Set([
  'adios',
  'arrivederci',
  'bonjour',
  'buongiorno',
  'ciao',
  'danke',
  'guten',
  'gracias',
  'grazie',
  'hola',
  'merci',
  'obrigada',
  'obrigado',
  'ola',
  'olá',
  'salut',
  'señor',
  'señora',
  'tschuss',
  'tschüss',
]);

const NON_LATIN_SCRIPT_PATTERNS: readonly RegExp[] = [
  /[\u0400-\u04FF\u0500-\u052F]/g,
  /[\u0590-\u05FF]/g,
  /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/g,
  /[\u0900-\u097F]/g,
  /[\u0E00-\u0E7F]/g,
  /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/g,
  /[\u3040-\u30FF]/g,
  /[\u3400-\u4DBF\u4E00-\u9FFF]/g,
];

const NUMBER_WORDS_UNDER_TWENTY = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
] as const;

const NUMBER_WORDS_TENS = [
  '',
  '',
  'twenty',
  'thirty',
  'forty',
  'fifty',
  'sixty',
  'seventy',
  'eighty',
  'ninety',
] as const;

const NUMBER_WORDS_SCALES = [
  { value: 1_000_000_000, label: 'billion' },
  { value: 1_000_000, label: 'million' },
  { value: 1_000, label: 'thousand' },
] as const;

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

function stripMarkdownForTTSAnalysis(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/(\*{1,3}|_{1,3})(.*?)\1/g, '$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^>\s+/gm, '')
    .replace(/^[-*_]{3,}\s*$/gm, ' ')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(EMOJI_REGEX, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function convertIntegerToEnglishWords(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('Unsupported integer for TTS number conversion.');
  }

  if (value < 20) {
    return NUMBER_WORDS_UNDER_TWENTY[value] ?? String(value);
  }

  if (value < 100) {
    const tens = Math.floor(value / 10);
    const remainder = value % 10;
    const tensWord = NUMBER_WORDS_TENS[tens] ?? String(value);
    return remainder === 0
      ? tensWord
      : `${tensWord}-${convertIntegerToEnglishWords(remainder)}`;
  }

  if (value < 1_000) {
    const hundreds = Math.floor(value / 100);
    const remainder = value % 100;
    const hundredsWord = `${convertIntegerToEnglishWords(hundreds)} hundred`;
    return remainder === 0
      ? hundredsWord
      : `${hundredsWord} ${convertIntegerToEnglishWords(remainder)}`;
  }

  for (const scale of NUMBER_WORDS_SCALES) {
    if (value >= scale.value) {
      const leading = Math.floor(value / scale.value);
      const remainder = value % scale.value;
      const leadingWords = `${convertIntegerToEnglishWords(leading)} ${scale.label}`;
      return remainder === 0
        ? leadingWords
        : `${leadingWords} ${convertIntegerToEnglishWords(remainder)}`;
    }
  }

  return String(value);
}

function formatCurrencyAmountForTTS(amountText: string): string {
  const normalizedAmount = amountText.replace(/,/g, '');

  if (!/^\d+(?:\.\d+)?$/.test(normalizedAmount)) {
    return `${amountText} dollars`;
  }

  const [integerText, decimalText = ''] = normalizedAmount.split('.');
  const integerValue = Number(integerText);

  if (!Number.isSafeInteger(integerValue) || integerValue < 0) {
    return `${amountText} dollars`;
  }

  const integerWords = convertIntegerToEnglishWords(integerValue);

  if (decimalText.length === 0) {
    return `${integerWords} ${integerValue === 1 ? 'dollar' : 'dollars'}`;
  }

  const normalizedCentsText = decimalText.padEnd(2, '0').slice(0, 2);
  const centsValue = Number(normalizedCentsText);

  if (!Number.isSafeInteger(centsValue) || centsValue < 0) {
    return `${integerWords} ${integerValue === 1 ? 'dollar' : 'dollars'}`;
  }

  if (centsValue === 0) {
    return `${integerWords} ${integerValue === 1 ? 'dollar' : 'dollars'}`;
  }

  const centsWords = convertIntegerToEnglishWords(centsValue);
  const dollarPhrase = integerValue === 0
    ? ''
    : `${integerWords} ${integerValue === 1 ? 'dollar' : 'dollars'}`;
  const centPhrase = `${centsWords} ${centsValue === 1 ? 'cent' : 'cents'}`;

  return dollarPhrase.length > 0
    ? `${dollarPhrase} and ${centPhrase}`
    : centPhrase;
}

function formatDollarAmountForTTS(amountText: string): string {
  return formatCurrencyAmountForTTS(amountText);
}

function normalizeTextForTTS(text: string): string {
  return text
    .replace(/([0-9a-zA-Z)])\s*\+\s*(\$?[0-9a-zA-Z(])/g, '$1 plus $2')
    .replace(/([0-9a-zA-Z)])\s*=\s*(\$?[0-9a-zA-Z(])/g, '$1 equals $2')
    .replace(/([0-9a-zA-Z)])\s*×\s*(\$?[0-9a-zA-Z(])/g, '$1 times $2')
    .replace(/([0-9a-zA-Z)])\s*\*\s*(\$?[0-9a-zA-Z(])/g, '$1 times $2')
    .replace(/([0-9a-zA-Z)])\s*÷\s*(\$?[0-9a-zA-Z(])/g, '$1 divided by $2')
    .replace(/([0-9a-zA-Z)])\s*\/\s*(\$?[0-9a-zA-Z(])/g, '$1 divided by $2')
    .replace(/([0-9a-zA-Z)])\s*-\s*(\$?[0-9a-zA-Z(])/g, '$1 minus $2')
    .replace(/\$([0-9][0-9,]*(?:\.[0-9]+)?)/g, (_match, amountText: string) => formatDollarAmountForTTS(amountText));
}

export function prepareTextForTTS(text: string): string {
  return normalizeTextForTTS(stripMarkdownForTTSAnalysis(text))
    .replace(NON_SPEECH_SYMBOL_REGEX, ' ')
    .replace(/ {2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface TTSLanguageDecision {
  advisory?: string;
  analysisText: string;
  speechText: string;
  supported: boolean;
}

function hasUnsupportedNonLatinScript(text: string): boolean {
  const latinCount = countMatches(text, LATIN_LETTER_REGEX);
  const nonLatinCount = NON_LATIN_SCRIPT_PATTERNS.reduce(
    (total, pattern) => total + countMatches(text, pattern),
    0,
  );
  const totalLetterCount = latinCount + nonLatinCount;

  if (totalLetterCount === 0) {
    return false;
  }

  return (nonLatinCount >= 4 && nonLatinCount / totalLetterCount >= 0.2)
    || (nonLatinCount >= 8 && nonLatinCount >= latinCount);
}

function isProbablyNonEnglishLatinText(text: string): boolean {
  const words = text.toLowerCase().match(LATIN_WORD_REGEX) ?? [];

  if (words.length < 6) {
    return false;
  }

  const englishSignalCount = words.reduce(
    (count, word) => count + (ENGLISH_SIGNAL_WORDS.has(word) ? 1 : 0),
    0,
  );

  if (englishSignalCount > 0) {
    return false;
  }

  const nonEnglishSignalCount = words.reduce(
    (count, word) => count + (NON_ENGLISH_SIGNAL_WORDS.has(word) ? 1 : 0),
    0,
  );
  const accentedLatinCount = countMatches(text, ACCENTED_LATIN_REGEX);
  const invertedPunctuationCount = countMatches(text, INVERTED_PUNCTUATION_REGEX);

  return nonEnglishSignalCount >= 2
    || invertedPunctuationCount >= 1
    || accentedLatinCount >= 4;
}

export function analyzeTTSLanguageSupport(rawText: string): TTSLanguageDecision {
  const analysisText = stripMarkdownForTTSAnalysis(rawText);
  const speechText = prepareTextForTTS(rawText);

  if (!analysisText.trim()) {
    return {
      analysisText,
      speechText,
      supported: true,
    };
  }

  if (hasUnsupportedNonLatinScript(analysisText) || isProbablyNonEnglishLatinText(analysisText)) {
    return {
      advisory: TTS_NON_ENGLISH_ADVISORY,
      analysisText,
      speechText,
      supported: false,
    };
  }

  return {
    analysisText,
    speechText,
    supported: true,
  };
}