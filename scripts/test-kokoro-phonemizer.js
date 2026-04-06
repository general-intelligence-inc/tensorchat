const { phonemize } = require('phonemizer');

const KOKORO_SUPPORTED_CHARACTERS = new Set(
  Array.from(';:,.!?—…"() “” ̃ʣʥʦʨᵝꭧAIOQSTWYᵊabcdefghijklmnopqrstuvwxyzɑɐɒæβɔɕçɖðʤəɚɛɜɟɡɥɨɪʝɯɰŋɳɲɴøɸθœɹɾɻʁɽʂʃʈʧʊʋʌɣɤχʎʒʔˈˌːʰʲ↓→↗↘ᵻ'),
);

const KOKORO_SUBSTITUTIONS = [
  [/\u200d/g, ''],
  [/\r\n?/g, '\n'],
  [/ɫ/g, 'l'],
  [/ɝ/g, 'ɜɹ'],
  [/r/g, 'ɹ'],
  [/g/g, 'ɡ'],
];

const SAMPLES = [
  ['en-us', 'Hello world.'],
  ['en-us', 'TensorChat speaks on device.'],
  ['en-us', 'The girl curled her hair.'],
  ['en-us', 'Local inference keeps your data private.'],
  ['en-us', 'Schedule a meeting for 3:45 PM.'],
];

function normalizeKokoroPhonemes(phonemeText) {
  let normalized = phonemeText;

  for (const [pattern, replacement] of KOKORO_SUBSTITUTIONS) {
    normalized = normalized.replace(pattern, replacement);
  }

  return normalized
    .replace(/\s+/g, ' ')
    .replace(/ ?([,.;:!?])/g, '$1')
    .trim();
}

function getUnsupportedKokoroCharacters(phonemeText) {
  const unsupported = new Set();

  for (const character of Array.from(phonemeText)) {
    if (character === '\n' || KOKORO_SUPPORTED_CHARACTERS.has(character)) {
      continue;
    }

    unsupported.add(character);
  }

  return Array.from(unsupported).sort();
}

(async () => {
  let hasUnsupportedCharacters = false;

  for (const [language, text] of SAMPLES) {
    const segments = await phonemize(text, language);
    const phonemes = normalizeKokoroPhonemes(segments.join(' '));
    const unsupportedCharacters = getUnsupportedKokoroCharacters(phonemes);

    if (unsupportedCharacters.length > 0) {
      hasUnsupportedCharacters = true;
    }

    console.log(JSON.stringify({
      language,
      text,
      segments,
      phonemes,
      unsupportedCharacters,
    }, null, 2));
  }

  if (hasUnsupportedCharacters) {
    process.exitCode = 1;
  }
})();