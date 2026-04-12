/**
 * Mini-app identity derivation.
 *
 * The agent no longer picks the app's name or emoji — those are derived
 * deterministically from the user's first prompt at app-creation time, then
 * preserved verbatim across all subsequent iterations. This module is the
 * single source of truth for that derivation.
 *
 * Pure functions, no I/O, no LLM calls. Trivially unit-testable. The regex
 * table is the configurable knob — extend it as new app archetypes show up
 * in real usage.
 *
 * Why this exists: previously, the LLM emitted name + emoji on every
 * write_mini_app call, and the 2B/E2B-class model would "improve" them
 * unprompted ("Calculator" → "Calculator Pro", 🧮 → 🔢) on iteration. By
 * removing name/emoji from the agent's tool contract entirely, drift
 * becomes structurally impossible.
 */

export interface MiniAppIdentity {
  name: string;
  emoji: string;
}

/** Hard limit on derived app names. Matches the rename-dialog cap. */
export const MAX_APP_NAME_CHARS = 24;
/** Cap on emoji codepoints — accommodates ZWJ sequences and skin-tone modifiers. */
const MAX_EMOJI_CODEPOINTS = 6;

/**
 * Count graphemes-ish in a string. Some emoji are multi-codepoint (ZWJ
 * sequences like 👨‍👩‍👧‍👦) so naive String.length is wrong. Array.from
 * splits by codepoint which over-counts ZWJ sequences but is the cheapest
 * approximation that handles the common cases (flags, skin tones,
 * keycap sequences).
 *
 * Exposed so the rename dialog and any future emoji validation share the
 * same definition.
 */
export function codepointCount(str: string): number {
  return Array.from(str).length;
}

/**
 * Returns true if the string is a single emoji-like grapheme (1 to
 * MAX_EMOJI_CODEPOINTS codepoints, non-empty).
 */
export function isValidEmoji(str: string): boolean {
  if (!str) return false;
  const cp = codepointCount(str);
  return cp >= 1 && cp <= MAX_EMOJI_CODEPOINTS;
}

/**
 * Returns true if the string is a non-empty name within the length cap.
 */
export function isValidName(str: string): boolean {
  if (!str) return false;
  const trimmed = str.trim();
  return trimmed.length >= 1 && trimmed.length <= MAX_APP_NAME_CHARS;
}

// ---------------------------------------------------------------------------
// Name derivation
// ---------------------------------------------------------------------------

/**
 * Common framing prefixes the user might type before the actual app
 * description. Stripped before extracting the noun phrase. Order matters:
 * the longer phrases must come before their shorter substrings so they
 * win the regex match.
 */
const FRAMING_PREFIX = new RegExp(
  "^\\s*(?:" +
    "(?:please\\s+)?" +
    "(?:can\\s+you\\s+)?" +
    "(?:i\\s+(?:want|need|would\\s+like)\\s+)?" +
    "(?:build|make|create|generate|give|show|design|code)" +
    "\\s+(?:me\\s+)?" +
    "(?:a|an|the|some)?\\s*" +
  ")",
  "i",
);

/**
 * Strip a leading "build me a", "I want a", "please create the", etc.
 * framing from the prompt before extracting the app's name.
 */
function stripFramingPrefix(prompt: string): string {
  return prompt.replace(FRAMING_PREFIX, "").trim();
}

/**
 * Derive a short app name from the user's first prompt. Heuristic:
 * 1. Strip "build me a / I want a / please create" framing
 * 2. Take the first 1-3 words
 * 3. Title-case them
 * 4. Truncate to MAX_APP_NAME_CHARS
 *
 * Fallback when the prompt is empty or all framing: "Mini App".
 */
export function deriveName(firstPrompt: string): string {
  const cleaned = stripFramingPrefix(firstPrompt ?? "");
  if (!cleaned) return "Mini App";

  const words = cleaned
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .slice(0, 3);
  if (words.length === 0) return "Mini App";

  const titleCased = words
    .map((w) => {
      const stripped = w.replace(/[^\p{L}\p{N}]/gu, "");
      if (stripped.length === 0) return "";
      return stripped.charAt(0).toUpperCase() + stripped.slice(1).toLowerCase();
    })
    .filter((w) => w.length > 0)
    .join(" ");

  if (!titleCased) return "Mini App";
  if (titleCased.length <= MAX_APP_NAME_CHARS) return titleCased;
  return titleCased.slice(0, MAX_APP_NAME_CHARS).trim();
}

// ---------------------------------------------------------------------------
// Emoji derivation
// ---------------------------------------------------------------------------

/**
 * Ordered regex → emoji mappings. First match wins. Each entry is
 * intentionally a fragment regex against the lowercased prompt; we don't
 * need anchors. Order is important — more specific terms must precede
 * generic ones (e.g. "stopwatch" before "watch").
 */
const EMOJI_MAP: ReadonlyArray<readonly [RegExp, string]> = [
  // Time / timing
  [/pomodoro|focus(?:\s+timer)?/i, "🍅"],
  [/stopwatch|countdown|timer|alarm|remind/i, "⏱"],
  [/clock|time\b/i, "🕐"],
  [/calendar|date|schedule|appointment/i, "📅"],

  // Math / numbers
  [/calc(?:ulator)?|arithmetic|math|equation|formula/i, "🧮"],
  [/convert(?:er)?|unit(?:s)?|currency/i, "🔁"],
  [/temperature|thermo|celsius|fahrenheit/i, "🌡"],

  // Lists / notes / writing
  [/todo|to[- ]?do|task|check[- ]?list/i, "✅"],
  [/note|journal|diary|writing|memo/i, "📝"],
  [/word|letter|spell(?:ing)?|vocab/i, "🔤"],

  // Money
  [/tip(?:\s+calc)?|bill|split/i, "💵"],
  [/budget|expense|money|cost|spending/i, "💰"],
  [/shopping|cart|store|buy|purchase/i, "🛒"],

  // Games / random
  [/dice|roll|d20|d6|tabletop/i, "🎲"],
  [/coin|flip|heads|tails/i, "🪙"],
  [/card|deck|poker|solitaire|hand/i, "🃏"],
  [/quiz|trivia|question/i, "❓"],
  [/puzzle|sudoku|maze/i, "🧩"],
  [/guess(?:ing)?|secret|riddle/i, "🤔"],
  [/game|play|score|points/i, "🎮"],

  // Health / fitness
  [/workout|exercise|rep|set|gym|fitness/i, "💪"],
  [/heart(?:rate)?|pulse|bpm/i, "💓"],
  [/habit|streak|tracker/i, "📊"],
  [/water|hydration|drink/i, "💧"],
  [/sleep|bedtime|snore/i, "😴"],

  // Creative / media
  [/color|palette|swatch|paint/i, "🎨"],
  [/draw|sketch|doodle/i, "🖌"],
  [/music|song|beat|metronome/i, "🎵"],
  [/photo|camera|gallery/i, "📷"],

  // Food
  [/recipe|cook(?:book|ing)?|meal|food|kitchen/i, "🍽"],

  // Weather / nature
  [/weather|forecast|rain|sunny/i, "⛅"],
  [/compass|direction|navigate|map/i, "🧭"],

  // Misc
  [/note(?:book)?|file|document/i, "📄"],
];

/** Fallback emoji when no archetype matches. */
const DEFAULT_EMOJI = "✨";

/**
 * Pick an emoji that best represents the user's prompt. Falls back to
 * DEFAULT_EMOJI if nothing in the EMOJI_MAP matches.
 */
export function deriveEmoji(firstPrompt: string): string {
  if (!firstPrompt) return DEFAULT_EMOJI;
  for (const [pattern, emoji] of EMOJI_MAP) {
    if (pattern.test(firstPrompt)) return emoji;
  }
  return DEFAULT_EMOJI;
}

// ---------------------------------------------------------------------------
// Public composite
// ---------------------------------------------------------------------------

/**
 * Derive both name and emoji from the user's first prompt.
 *
 * Called once per app at creation time, never on iteration. The result
 * is stored in the app's meta.json and preserved across all subsequent
 * iterations — the LLM cannot change it via tool calls.
 *
 * The user can override either field via the long-press "Rename" UI in
 * MiniAppHome, which calls `renameApp()` in storage.ts directly.
 */
export function deriveAppIdentity(firstPrompt: string): MiniAppIdentity {
  return {
    name: deriveName(firstPrompt),
    emoji: deriveEmoji(firstPrompt),
  };
}
