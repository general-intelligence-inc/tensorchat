export type DetectedTranslationLanguageCode =
  | "ar"
  | "de"
  | "en"
  | "es"
  | "fr"
  | "hi"
  | "it"
  | "ja"
  | "ko"
  | "pt"
  | "ro"
  | "ru"
  | "zh";

const DETECTED_TRANSLATION_LANGUAGE_LABELS: Record<
  DetectedTranslationLanguageCode,
  string
> = {
  ar: "Arabic",
  de: "German",
  en: "English",
  es: "Spanish",
  fr: "French",
  hi: "Hindi",
  it: "Italian",
  ja: "Japanese",
  ko: "Korean",
  pt: "Portuguese",
  ro: "Romanian",
  ru: "Russian",
  zh: "Chinese",
};

const ARABIC_SCRIPT_REGEX = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/u;
const DEVANAGARI_SCRIPT_REGEX = /[\u0900-\u097F]/u;
const CYRILLIC_SCRIPT_REGEX = /[\u0400-\u04FF\u0500-\u052F]/u;
const HIRAGANA_KATAKANA_REGEX = /[\u3040-\u30FF]/u;
const HANGUL_REGEX = /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/u;
const HAN_REGEX = /[\u3400-\u4DBF\u4E00-\u9FFF]/u;
const LATIN_WORD_REGEX =
  /[A-Za-z\u00C0-\u024F]+(?:['’-][A-Za-z\u00C0-\u024F]+)*/g;

type LatinLanguageCode = "de" | "en" | "es" | "fr" | "it" | "pt" | "ro";

const LATIN_LANGUAGE_HINTS: Record<
  LatinLanguageCode,
  {
    uniquePattern?: RegExp;
    weightedWords: readonly string[];
  }
> = {
  de: {
    uniquePattern: /[äöüß]/i,
    weightedWords: [
      "danke",
      "bitte",
      "nicht",
      "hallo",
      "für",
      "über",
      "und",
      "ist",
      "ich",
    ],
  },
  en: {
    weightedWords: [
      "hello",
      "thanks",
      "please",
      "the",
      "and",
      "with",
      "this",
      "that",
      "what",
      "you",
      "are",
      "is",
    ],
  },
  es: {
    uniquePattern: /[ñ¿¡]/i,
    weightedWords: [
      "hola",
      "gracias",
      "cómo",
      "como",
      "está",
      "estás",
      "porque",
      "por",
      "para",
      "señor",
      "señora",
    ],
  },
  fr: {
    uniquePattern: /[œæ]/i,
    weightedWords: [
      "bonjour",
      "merci",
      "avec",
      "pour",
      "vous",
      "nous",
      "être",
      "etre",
      "pas",
      "cette",
      "ça",
      "ca",
    ],
  },
  it: {
    weightedWords: [
      "ciao",
      "grazie",
      "sono",
      "questo",
      "questa",
      "per",
      "con",
      "non",
      "come",
      "buongiorno",
    ],
  },
  pt: {
    uniquePattern: /[ãõ]/i,
    weightedWords: [
      "olá",
      "ola",
      "obrigado",
      "obrigada",
      "você",
      "voce",
      "não",
      "nao",
      "pra",
      "com",
      "uma",
      "está",
    ],
  },
  ro: {
    uniquePattern: /[ăâîșşțţ]/i,
    weightedWords: [
      "bună",
      "buna",
      "mulțumesc",
      "multumesc",
      "și",
      "si",
      "este",
      "sunt",
      "pentru",
      "aceasta",
      "acesta",
      "în",
      "in",
    ],
  },
};

function tokenizeLatinWords(text: string): string[] {
  return text.toLowerCase().match(LATIN_WORD_REGEX) ?? [];
}

function scoreLatinLanguage(
  language: LatinLanguageCode,
  text: string,
  tokens: string[],
): number {
  const hints = LATIN_LANGUAGE_HINTS[language];
  let score = 0;

  if (hints.uniquePattern?.test(text)) {
    score += 4;
  }

  for (const token of tokens) {
    if (hints.weightedWords.includes(token as never)) {
      score += token.length >= 5 ? 3 : 2;
    }
  }

  return score;
}

export function getDetectedTranslationLanguageLabel(
  code: DetectedTranslationLanguageCode,
): string {
  return DETECTED_TRANSLATION_LANGUAGE_LABELS[code];
}

export function detectTranslationSourceLanguage(
  text: string,
  options?: {
    fallbackLanguage?: DetectedTranslationLanguageCode;
    targetLanguage?: DetectedTranslationLanguageCode;
  },
): DetectedTranslationLanguageCode {
  const normalizedText = text.trim();
  const fallbackLanguage =
    options?.fallbackLanguage ??
    (options?.targetLanguage === "en" ? "es" : "en");

  if (normalizedText.length === 0) {
    return fallbackLanguage;
  }

  if (ARABIC_SCRIPT_REGEX.test(normalizedText)) {
    return "ar";
  }

  if (DEVANAGARI_SCRIPT_REGEX.test(normalizedText)) {
    return "hi";
  }

  if (CYRILLIC_SCRIPT_REGEX.test(normalizedText)) {
    return "ru";
  }

  if (HIRAGANA_KATAKANA_REGEX.test(normalizedText)) {
    return "ja";
  }

  if (HANGUL_REGEX.test(normalizedText)) {
    return "ko";
  }

  if (HAN_REGEX.test(normalizedText)) {
    return "zh";
  }

  const tokens = tokenizeLatinWords(normalizedText);
  if (tokens.length === 0) {
    return fallbackLanguage;
  }

  const candidateLanguages = Object.keys(
    LATIN_LANGUAGE_HINTS,
  ) as LatinLanguageCode[];
  let bestLanguage: DetectedTranslationLanguageCode = fallbackLanguage;
  let bestScore = -1;

  for (const language of candidateLanguages) {
    const score = scoreLatinLanguage(language, normalizedText, tokens);
    if (score > bestScore) {
      bestScore = score;
      bestLanguage = language;
    }
  }

  return bestScore > 0 ? bestLanguage : fallbackLanguage;
}
