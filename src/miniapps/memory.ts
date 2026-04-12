import RNFS from "react-native-fs";

/**
 * Per-chat durable agent memory.
 *
 * This is the AGENT'S memory across turns — not the mini-app's runtime
 * data. The agent writes short one-liners via the `notes` parameter on
 * `write_mini_app`, and those notes are read back into the system prompt
 * on subsequent turns. Lets the agent remember decisions and preferences
 * without having to re-derive them from the app code every time.
 *
 * Storage: one JSON file per chat at `<docDir>/miniapps-memory/<chatId>.json`.
 * Keyed by chatId (not appId) so memory exists even before the first
 * successful write_mini_app call.
 *
 * Compaction: hard cap at MAX_NOTES_PER_CHAT. When new notes would exceed
 * the cap, the oldest entries are dropped. Eventually we may add
 * LLM-based summarisation but for now truncation keeps things simple and
 * avoids back-to-back llama completions (which race the context).
 */

export interface MemoryNote {
  id: string;
  text: string;
  createdAt: number;
}

export interface MiniAppMemory {
  notes: MemoryNote[];
}

const MEMORY_DIR = `${RNFS.DocumentDirectoryPath}/miniapps-memory`;
/** Hard cap on notes per chat. Oldest notes beyond this are dropped. */
export const MAX_NOTES_PER_CHAT = 10;
/** Per-note text length cap to keep the injection budget predictable. */
export const MAX_NOTE_CHARS = 240;
/** Max notes accepted from a single write_mini_app call. */
export const MAX_NOTES_PER_WRITE = 3;

async function ensureMemoryDir(): Promise<void> {
  const exists = await RNFS.exists(MEMORY_DIR);
  if (!exists) {
    await RNFS.mkdir(MEMORY_DIR);
  }
}

function memoryFilePath(chatId: string): string {
  // Guard against path-traversal by whitelisting basic chars.
  const safe = chatId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${MEMORY_DIR}/${safe}.json`;
}

function generateNoteId(): string {
  return (
    "note_" +
    Date.now().toString(36) +
    "_" +
    Math.random().toString(36).slice(2, 8)
  );
}

/** Read the memory for a chat. Returns an empty memory if the file is absent or malformed. */
export async function readMemory(chatId: string): Promise<MiniAppMemory> {
  const path = memoryFilePath(chatId);
  try {
    const exists = await RNFS.exists(path);
    if (!exists) return { notes: [] };
    const raw = await RNFS.readFile(path, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.notes)) {
      return { notes: [] };
    }
    const notes = parsed.notes
      .filter(
        (n: unknown): n is MemoryNote =>
          !!n &&
          typeof n === "object" &&
          typeof (n as MemoryNote).id === "string" &&
          typeof (n as MemoryNote).text === "string" &&
          typeof (n as MemoryNote).createdAt === "number",
      )
      .slice(-MAX_NOTES_PER_CHAT);
    return { notes };
  } catch {
    return { notes: [] };
  }
}

async function writeMemory(chatId: string, memory: MiniAppMemory): Promise<void> {
  await ensureMemoryDir();
  const path = memoryFilePath(chatId);
  // Tmp-write + rename for atomicity.
  const tmp = `${path}.tmp`;
  await RNFS.writeFile(tmp, JSON.stringify(memory), "utf8");
  await RNFS.unlink(path).catch(() => {});
  await RNFS.moveFile(tmp, path);
}

/**
 * Append up to MAX_NOTES_PER_WRITE new notes and truncate the result to
 * MAX_NOTES_PER_CHAT (dropping oldest). Each note text is trimmed and
 * length-capped. Returns the resulting memory.
 */
export async function appendMemoryNotes(
  chatId: string,
  texts: string[],
): Promise<MiniAppMemory> {
  const sanitized = texts
    .map((t) => (typeof t === "string" ? t.trim() : ""))
    .filter((t) => t.length > 0)
    .slice(0, MAX_NOTES_PER_WRITE)
    .map((t) =>
      t.length > MAX_NOTE_CHARS ? t.slice(0, MAX_NOTE_CHARS) + "…" : t,
    );

  if (sanitized.length === 0) {
    return readMemory(chatId);
  }

  const existing = await readMemory(chatId);
  const now = Date.now();
  const newNotes: MemoryNote[] = sanitized.map((text) => ({
    id: generateNoteId(),
    text,
    createdAt: now,
  }));

  const merged: MemoryNote[] = [...existing.notes, ...newNotes];
  // Hard cap: keep only the most recent MAX_NOTES_PER_CHAT.
  const truncated = merged.slice(-MAX_NOTES_PER_CHAT);
  const next: MiniAppMemory = { notes: truncated };
  await writeMemory(chatId, next);
  return next;
}

/** Delete a chat's memory file entirely (used when the chat is deleted). */
export async function deleteMemory(chatId: string): Promise<void> {
  const path = memoryFilePath(chatId);
  await RNFS.unlink(path).catch(() => {});
}

/**
 * Format the memory for injection into the agent's system prompt. Returns
 * an empty string if there are no notes so callers can concatenate unconditionally.
 */
export function formatMemoryForPrompt(memory: MiniAppMemory): string {
  if (memory.notes.length === 0) return "";
  const lines = memory.notes.map((n, i) => `${i + 1}. ${n.text}`);
  return (
    `\n\nNotes from previous turns in this chat (your durable memory — treat these as facts you already decided):\n` +
    lines.join("\n") +
    `\n`
  );
}
