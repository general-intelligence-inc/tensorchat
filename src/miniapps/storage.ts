import AsyncStorage from "@react-native-async-storage/async-storage";
import RNFS from "react-native-fs";
import {
  MINIAPP_INDEX_STORAGE_KEY,
  MINIAPP_STORAGE_VERSION,
  type MiniApp,
  type MiniAppIndexEntry,
  type MiniAppMeta,
  type WriteMiniAppInput,
} from "./types";
import { TC_RUNTIME_JS } from "./runtime/tc";
import { TC_THEME_CSS } from "./runtime/theme";

const MIGRATION_STATE_KEY = "tensorchat_miniapps_migration_version";

export const MINIAPPS_DIR = `${RNFS.DocumentDirectoryPath}/miniapps`;

// ---------------------------------------------------------------------------
// Directory helpers
// ---------------------------------------------------------------------------

async function ensureRootDir(): Promise<void> {
  const exists = await RNFS.exists(MINIAPPS_DIR);
  if (!exists) {
    await RNFS.mkdir(MINIAPPS_DIR);
  }
}

function appDir(appId: string): string {
  return `${MINIAPPS_DIR}/${appId}`;
}

function appFilePath(appId: string, filename: string): string {
  return `${appDir(appId)}/${filename}`;
}

function appHistoryDir(appId: string): string {
  return `${appDir(appId)}/history`;
}

function appHistoryFilePath(
  appId: string,
  version: number,
  kind: "program" | "meta",
): string {
  const ext = kind === "program" ? "program.js" : "meta.json";
  return `${appHistoryDir(appId)}/v${version}.${ext}`;
}

async function ensureAppDir(appId: string): Promise<void> {
  await ensureRootDir();
  const dir = appDir(appId);
  const exists = await RNFS.exists(dir);
  if (!exists) {
    await RNFS.mkdir(dir);
  }
}

async function ensureAppHistoryDir(appId: string): Promise<void> {
  await ensureAppDir(appId);
  const dir = appHistoryDir(appId);
  const exists = await RNFS.exists(dir);
  if (!exists) {
    await RNFS.mkdir(dir);
  }
}

/**
 * List the version numbers present in an app's history/ subdirectory,
 * sorted ascending (oldest first). Non-existent directory → empty array.
 * Malformed filenames are skipped.
 */
async function listHistoryVersions(appId: string): Promise<number[]> {
  const dir = appHistoryDir(appId);
  const exists = await RNFS.exists(dir);
  if (!exists) return [];
  try {
    const entries = await RNFS.readDir(dir);
    const versions = new Set<number>();
    for (const entry of entries) {
      if (entry.isFile()) {
        const match = /^v(\d+)\.(program\.js|meta\.json)$/.exec(entry.name);
        if (match) versions.add(parseInt(match[1], 10));
      }
    }
    return Array.from(versions).sort((a, b) => a - b);
  } catch {
    return [];
  }
}

/**
 * Trim history to the `max` most recent versions, deleting older snapshots.
 * Called after each snapshot write to enforce the ring-buffer cap.
 */
async function trimHistory(appId: string, max: number): Promise<void> {
  const versions = await listHistoryVersions(appId);
  if (versions.length <= max) return;
  const toDrop = versions.slice(0, versions.length - max);
  for (const v of toDrop) {
    await deleteIfExists(appHistoryFilePath(appId, v, "program"));
    await deleteIfExists(appHistoryFilePath(appId, v, "meta"));
  }
}

/**
 * Capture the current on-disk state of an app into history/. Called by
 * `writeAppIteration` BEFORE overwriting program.js / meta.json / index.html
 * so the undo path has the previous version intact.
 */
async function snapshotCurrentToHistory(appId: string): Promise<void> {
  const existing = await readApp(appId);
  if (!existing) return;
  await ensureAppHistoryDir(appId);
  const programDest = appHistoryFilePath(appId, existing.version, "program");
  const metaDest = appHistoryFilePath(appId, existing.version, "meta");
  // Use atomic writes so a crash mid-snapshot leaves either the previous
  // state or nothing — never a half-snapshot the undo path might trip on.
  await atomicWrite(programDest, existing.program);
  await atomicWrite(
    metaDest,
    JSON.stringify({
      name: existing.name,
      emoji: existing.emoji,
      version: existing.version,
      chatId: existing.chatId,
      createdAt: existing.createdAt,
      updatedAt: existing.updatedAt,
      schemaVersion: existing.schemaVersion ?? MINIAPP_STORAGE_VERSION,
    } satisfies MiniAppMeta),
  );
}

const MINIAPP_HISTORY_MAX = 10;

async function deleteIfExists(path: string): Promise<void> {
  await RNFS.unlink(path).catch(() => {});
}

/**
 * Atomic write: write to `<path>.tmp` then move into place.
 * react-native-fs's moveFile overwrites on most platforms, but to be safe
 * we delete the target first.
 */
async function atomicWrite(
  path: string,
  content: string,
  encoding: "utf8" | "base64" = "utf8",
): Promise<void> {
  const tmp = `${path}.tmp`;
  await deleteIfExists(tmp);
  await RNFS.writeFile(tmp, content, encoding);
  await deleteIfExists(path);
  await RNFS.moveFile(tmp, path);
}

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

export function generateMiniAppId(): string {
  return (
    "mapp_" +
    Date.now().toString(36) +
    "_" +
    Math.random().toString(36).slice(2, 8)
  );
}

// ---------------------------------------------------------------------------
// HTML wrapper generation
// ---------------------------------------------------------------------------

/**
 * Escape sequences that would prematurely close our wrapper <style> / <script>
 * tags when the user program contains literal "</style>" or "</script>" strings.
 * Standard in-HTML-string trick: split the closing token so the HTML parser
 * can't see it.
 */
function escapeForScriptTag(js: string): string {
  return js.replace(/<\/script/gi, "<\\/script");
}

/**
 * Sandbox shim injected before the tc runtime.
 *
 * Two jobs:
 *   1. Neutralize network APIs as defense-in-depth against a malicious or
 *      accidentally-unsafe generated program. CSP (below) is the primary
 *      defense; this shim is the belt-and-suspenders layer.
 *   2. Relay runtime JS errors to React Native via window.ReactNativeWebView
 *      so the self-correction loop can feed them back to the Agent.
 *
 * Note: the tc runtime ALSO posts errors via its error banner path, so the
 * error-relay listeners below are a second layer catching anything that
 * slips past tc (e.g. syntax errors that prevent tc from loading at all).
 */
const SANDBOX_SHIM = `
(function() {
  var block = function() { throw new Error("Network access is disabled in mini-apps"); };
  try { window.fetch = block; } catch (e) {}
  try { window.XMLHttpRequest = function() { block(); }; } catch (e) {}
  try { window.WebSocket = function() { block(); }; } catch (e) {}
  try { window.EventSource = function() { block(); }; } catch (e) {}
  try { if (navigator.sendBeacon) navigator.sendBeacon = function() { return false; }; } catch (e) {}
  try { if (navigator.serviceWorker) { delete navigator.serviceWorker; } } catch (e) {}
  try { if (navigator.geolocation) navigator.geolocation = undefined; } catch (e) {}
  try { if (navigator.mediaDevices) navigator.mediaDevices = undefined; } catch (e) {}
  try { if (window.Notification) window.Notification = undefined; } catch (e) {}

  function postError(payload) {
    try {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify(payload));
      }
    } catch (e) {}
  }

  window.addEventListener("error", function(e) {
    postError({
      type: "js-error",
      message: (e && e.message) || "Unknown error",
      source: e && e.filename,
      line: e && e.lineno,
      col: e && e.colno,
      stack: e && e.error && e.error.stack ? String(e.error.stack).slice(0, 800) : null
    });
  });

  window.addEventListener("unhandledrejection", function(e) {
    var reason = e && e.reason;
    var msg = reason && reason.message ? reason.message : String(reason);
    postError({ type: "js-error", message: "Unhandled promise rejection: " + msg });
  });
})();
`;

const CSP_DIRECTIVES =
  "default-src 'self' 'unsafe-inline'; " +
  "script-src 'self' 'unsafe-inline'; " +
  "style-src 'self' 'unsafe-inline'; " +
  "connect-src 'none'; " +
  "img-src 'self' data: blob:; " +
  "font-src 'self' data:; " +
  "media-src 'self' data: blob:; " +
  "object-src 'none'; " +
  "base-uri 'none'; " +
  "form-action 'none'; " +
  "frame-src 'none'; " +
  "worker-src 'none';";

/**
 * Build the final `index.html` wrapper that the WebView actually loads.
 *
 * The wrapper is a FIXED shell we own: CSP meta → tc theme CSS → sandbox
 * shim → tc runtime → user program. The LLM only contributes the user
 * program — everything else is static code baked into the harness.
 */
export function buildIndexHtml(params: { program: string }): string {
  const { program } = params;

  const safeShim = escapeForScriptTag(SANDBOX_SHIM);
  const safeRuntime = escapeForScriptTag(TC_RUNTIME_JS);
  const safeProgram = escapeForScriptTag(program);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"/>
<meta http-equiv="Content-Security-Policy" content="${CSP_DIRECTIVES}"/>
<style>
${TC_THEME_CSS}
</style>
<script>${safeShim}</script>
<script>${safeRuntime}</script>
</head>
<body>
<div id="tc-root"></div>
<script>
try {
${safeProgram}
} catch (err) {
  if (window.tc && typeof window.tc.mount === "function") {
    // tc loaded but the user program threw at top level — surface it.
    var root = document.getElementById("tc-root");
    if (root) {
      root.innerHTML = '<div class="tc-error-banner">Top-level error: ' + (err && err.message ? String(err.message).replace(/</g, "&lt;") : String(err)) + '</div>';
    }
  }
  try {
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: "js-error",
        message: "Top-level: " + (err && err.message ? err.message : String(err)),
        stack: err && err.stack ? String(err.stack).slice(0, 800) : null
      }));
    }
  } catch (e) {}
}
</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// App read / write / delete
// ---------------------------------------------------------------------------

export async function readApp(appId: string): Promise<MiniApp | null> {
  const metaPath = appFilePath(appId, "meta.json");
  const metaExists = await RNFS.exists(metaPath);
  if (!metaExists) return null;

  try {
    const [metaRaw, programRaw] = await Promise.all([
      RNFS.readFile(metaPath, "utf8"),
      RNFS.readFile(appFilePath(appId, "program.js"), "utf8").catch(() => ""),
    ]);

    const meta = JSON.parse(metaRaw) as MiniAppMeta;
    // Legacy v1 apps don't have `schemaVersion`; they store html/css/js
    // instead of program.js. Refuse to load them — they can't run in the
    // component runtime. The startup migration wipes them separately.
    if (meta.schemaVersion !== MINIAPP_STORAGE_VERSION) {
      return null;
    }
    return {
      id: appId,
      name: meta.name,
      emoji: meta.emoji,
      version: meta.version,
      chatId: meta.chatId,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
      schemaVersion: meta.schemaVersion,
      program: programRaw,
    };
  } catch {
    return null;
  }
}

/**
 * Dispatcher: routes to writeAppNew (creation, requires identity) or
 * writeAppIteration (updates, preserves identity from disk) based on
 * the input variant.
 */
export async function writeApp(input: WriteMiniAppInput): Promise<MiniApp> {
  if (input.kind === "new") return writeAppNew(input);
  return writeAppIteration(input);
}

/**
 * Create a brand-new mini-app for a chat that doesn't have one yet.
 * Caller must supply name + emoji (typically derived via
 * `deriveAppIdentity` from the user's first prompt).
 */
async function writeAppNew(input: {
  kind: "new";
  chatId: string;
  name: string;
  emoji: string;
  program: string;
}): Promise<MiniApp> {
  const now = Date.now();
  const appId = generateMiniAppId();

  const meta: MiniAppMeta = {
    name: input.name,
    emoji: input.emoji,
    version: 1,
    chatId: input.chatId,
    createdAt: now,
    updatedAt: now,
    schemaVersion: MINIAPP_STORAGE_VERSION,
  };

  await ensureAppDir(appId);

  const indexHtml = buildIndexHtml({ program: input.program });

  // Order matters: content first, then meta.json LAST so an interrupted
  // write leaves no meta and the app is treated as non-existent.
  await atomicWrite(appFilePath(appId, "program.js"), input.program);
  await atomicWrite(appFilePath(appId, "index.html"), indexHtml);
  await atomicWrite(appFilePath(appId, "meta.json"), JSON.stringify(meta));

  await upsertIndexEntry({
    id: appId,
    chatId: meta.chatId,
    name: meta.name,
    emoji: meta.emoji,
    version: meta.version,
    updatedAt: meta.updatedAt,
  });

  return {
    id: appId,
    program: input.program,
    ...meta,
  };
}

/**
 * Iterate on an existing mini-app: preserve name + emoji + createdAt
 * from the existing meta.json, bump the version, write the new program.
 * The agent's tool calls this path on every turn after the first.
 */
async function writeAppIteration(input: {
  kind: "iteration";
  id: string;
  chatId: string;
  program: string;
}): Promise<MiniApp> {
  const now = Date.now();
  const appId = input.id;

  const existing = await readApp(appId);
  if (!existing) {
    // Defensive — fall back to creating a new app with placeholder
    // identity. Caller should never hit this in practice (it would
    // imply the app id was pulled from the index but the meta.json
    // is missing on disk).
    return writeAppNew({
      kind: "new",
      chatId: input.chatId,
      name: "Mini App",
      emoji: "✨",
      program: input.program,
    });
  }

  const meta: MiniAppMeta = {
    name: existing.name,
    emoji: existing.emoji,
    version: existing.version + 1,
    chatId: existing.chatId,
    createdAt: existing.createdAt,
    updatedAt: now,
    schemaVersion: MINIAPP_STORAGE_VERSION,
  };

  await ensureAppDir(appId);

  // Snapshot the CURRENT state into history/ BEFORE overwriting. Errors
  // here must not block the iteration — worst case, the user loses undo
  // for this single step but the new version still lands correctly.
  try {
    await snapshotCurrentToHistory(appId);
    await trimHistory(appId, MINIAPP_HISTORY_MAX);
  } catch (err) {
    console.warn("[TensorChat] history snapshot failed:", err);
  }

  const indexHtml = buildIndexHtml({ program: input.program });

  await atomicWrite(appFilePath(appId, "program.js"), input.program);
  await atomicWrite(appFilePath(appId, "index.html"), indexHtml);
  await atomicWrite(appFilePath(appId, "meta.json"), JSON.stringify(meta));

  await upsertIndexEntry({
    id: appId,
    chatId: meta.chatId,
    name: meta.name,
    emoji: meta.emoji,
    version: meta.version,
    updatedAt: meta.updatedAt,
  });

  return {
    id: appId,
    program: input.program,
    ...meta,
  };
}

/**
 * Roll back to the most recent snapshot in `history/`. The current
 * version is DESTROYED (not preserved). The target snapshot is PROMOTED
 * to current (and removed from history). This is a linear rollback — any
 * forward path is discarded, matching the one-tap undo UX.
 *
 * Returns the restored MiniApp on success, or null on any failure:
 *   - app doesn't exist
 *   - version is already 1 (nothing to roll back to)
 *   - no snapshot exists for version - 1
 *   - snapshot read failed
 */
export async function undoApp(appId: string): Promise<MiniApp | null> {
  const current = await readApp(appId);
  if (!current) return null;
  if (current.version <= 1) return null;

  // The snapshot we want to restore is the one captured for the version
  // that's BELOW the current. snapshots are taken pre-overwrite, so a
  // snapshot at version=N represents the on-disk state BEFORE the N+1
  // write happened — which is exactly the state we want to restore.
  const targetVersion = current.version - 1;
  const targetProgramPath = appHistoryFilePath(appId, targetVersion, "program");
  const targetMetaPath = appHistoryFilePath(appId, targetVersion, "meta");

  const [programExists, metaExists] = await Promise.all([
    RNFS.exists(targetProgramPath),
    RNFS.exists(targetMetaPath),
  ]);
  if (!programExists || !metaExists) return null;

  let restoredProgram: string;
  let restoredMeta: MiniAppMeta;
  try {
    const [programRaw, metaRaw] = await Promise.all([
      RNFS.readFile(targetProgramPath, "utf8"),
      RNFS.readFile(targetMetaPath, "utf8"),
    ]);
    restoredProgram = programRaw;
    restoredMeta = JSON.parse(metaRaw) as MiniAppMeta;
  } catch (err) {
    console.warn("[TensorChat] undo read failed:", err);
    return null;
  }

  if (restoredMeta.schemaVersion !== MINIAPP_STORAGE_VERSION) return null;

  // Rebuild the HTML wrapper from the restored program. Touch updatedAt
  // so the grid sorts by recency correctly after rollback, but preserve
  // the restored version number (no bump — undo is not a forward step).
  const restoredMetaWithTouch: MiniAppMeta = {
    ...restoredMeta,
    updatedAt: Date.now(),
  };

  const indexHtml = buildIndexHtml({ program: restoredProgram });

  try {
    await atomicWrite(appFilePath(appId, "program.js"), restoredProgram);
    await atomicWrite(appFilePath(appId, "index.html"), indexHtml);
    await atomicWrite(
      appFilePath(appId, "meta.json"),
      JSON.stringify(restoredMetaWithTouch),
    );
  } catch (err) {
    console.warn("[TensorChat] undo write failed:", err);
    return null;
  }

  // Delete the snapshot we just promoted (no longer needed) AND the
  // snapshot captured for the now-destroyed forward version, if any.
  // The forward-version snapshot (at current.version) exists only if
  // someone iterated on top of the current version — typically it
  // doesn't exist yet, but deleteIfExists handles both cases cleanly.
  await deleteIfExists(targetProgramPath);
  await deleteIfExists(targetMetaPath);
  await deleteIfExists(appHistoryFilePath(appId, current.version, "program"));
  await deleteIfExists(appHistoryFilePath(appId, current.version, "meta"));

  await upsertIndexEntry({
    id: appId,
    chatId: restoredMetaWithTouch.chatId,
    name: restoredMetaWithTouch.name,
    emoji: restoredMetaWithTouch.emoji,
    version: restoredMetaWithTouch.version,
    updatedAt: restoredMetaWithTouch.updatedAt,
  });

  return {
    id: appId,
    program: restoredProgram,
    ...restoredMetaWithTouch,
  };
}

/**
 * Rename an app: update name and/or emoji in meta.json without touching
 * the program or bumping the version. Used by the long-press "Rename"
 * action sheet in MiniAppHome.
 *
 * Returns the updated MiniApp on success, or null if the app is missing
 * or the meta.json read fails.
 */
export async function renameApp(
  appId: string,
  patch: { name?: string; emoji?: string },
): Promise<MiniApp | null> {
  const existing = await readApp(appId);
  if (!existing) return null;

  const nextName =
    typeof patch.name === "string" && patch.name.trim().length > 0
      ? patch.name.trim()
      : existing.name;
  const nextEmoji =
    typeof patch.emoji === "string" && patch.emoji.trim().length > 0
      ? patch.emoji.trim()
      : existing.emoji;

  if (nextName === existing.name && nextEmoji === existing.emoji) {
    // No-op rename — return the existing app unchanged.
    return existing;
  }

  const meta: MiniAppMeta = {
    name: nextName,
    emoji: nextEmoji,
    version: existing.version,
    chatId: existing.chatId,
    createdAt: existing.createdAt,
    updatedAt: Date.now(),
    schemaVersion: existing.schemaVersion ?? MINIAPP_STORAGE_VERSION,
  };

  await atomicWrite(appFilePath(appId, "meta.json"), JSON.stringify(meta));

  await upsertIndexEntry({
    id: appId,
    chatId: meta.chatId,
    name: meta.name,
    emoji: meta.emoji,
    version: meta.version,
    updatedAt: meta.updatedAt,
  });

  return {
    id: appId,
    program: existing.program,
    ...meta,
  };
}

// ---------------------------------------------------------------------------
// Legacy migration — one-shot wipe of v1 apps on startup
// ---------------------------------------------------------------------------

/**
 * One-time migration: on first launch of the component-runtime build,
 * delete every mini-app that was written under the old raw html/css/js
 * schema. Those apps can't run in the tc runtime, and the LLM doesn't
 * know how to iterate on them in the new mode either.
 *
 * Called from ChatScreen on mount. Idempotent — only runs once per
 * schema-version bump, tracked via MIGRATION_STATE_KEY in AsyncStorage.
 */
export async function migrateMiniAppsIfNeeded(): Promise<{
  migrated: boolean;
  removedCount: number;
}> {
  const storedVersionRaw = await AsyncStorage.getItem(MIGRATION_STATE_KEY);
  const storedVersion = storedVersionRaw ? parseInt(storedVersionRaw, 10) : 0;
  if (storedVersion === MINIAPP_STORAGE_VERSION) {
    return { migrated: false, removedCount: 0 };
  }

  let removedCount = 0;
  try {
    const rootExists = await RNFS.exists(MINIAPPS_DIR);
    if (rootExists) {
      const entries = await RNFS.readDir(MINIAPPS_DIR);
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const metaPath = `${entry.path}/meta.json`;
        const metaExists = await RNFS.exists(metaPath);
        let shouldDelete = true;
        if (metaExists) {
          try {
            const raw = await RNFS.readFile(metaPath, "utf8");
            const parsed = JSON.parse(raw) as MiniAppMeta;
            if (parsed.schemaVersion === MINIAPP_STORAGE_VERSION) {
              shouldDelete = false;
            }
          } catch {
            // Malformed meta → delete.
          }
        }
        if (shouldDelete) {
          await RNFS.unlink(entry.path).catch(() => {});
          removedCount++;
        }
      }
    }

    // Drop the AsyncStorage index entirely — old entries pointed at
    // wiped apps and had no schemaVersion to filter on.
    await AsyncStorage.removeItem(MINIAPP_INDEX_STORAGE_KEY);
  } catch (err) {
    console.warn("[TensorChat] mini-app migration failed:", err);
    // Don't mark the migration as complete so we try again next launch.
    return { migrated: false, removedCount };
  }

  await AsyncStorage.setItem(
    MIGRATION_STATE_KEY,
    String(MINIAPP_STORAGE_VERSION),
  );
  return { migrated: true, removedCount };
}

export async function deleteApp(appId: string): Promise<void> {
  const dir = appDir(appId);
  const exists = await RNFS.exists(dir);
  if (exists) {
    // RNFS.unlink recursively removes directories on both platforms.
    await RNFS.unlink(dir).catch(() => {});
  }
  await removeIndexEntry(appId);
}

/**
 * Returns the absolute file:// URI the WebView should load for this app.
 * Each app has its own directory, which gives each one its own origin —
 * localStorage is automatically namespaced per app.
 */
export function getAppFileUri(appId: string): string {
  return `file://${appFilePath(appId, "index.html")}`;
}

// ---------------------------------------------------------------------------
// Index read / write (AsyncStorage)
// ---------------------------------------------------------------------------

/**
 * Count how many distinct versions have a complete snapshot (both program
 * and meta files present) in this app's history/ directory. Used to
 * decide whether the undo button should be visible.
 */
async function countHistoryDepth(appId: string): Promise<number> {
  const versions = await listHistoryVersions(appId);
  let depth = 0;
  for (const v of versions) {
    const [hasProgram, hasMeta] = await Promise.all([
      RNFS.exists(appHistoryFilePath(appId, v, "program")),
      RNFS.exists(appHistoryFilePath(appId, v, "meta")),
    ]);
    if (hasProgram && hasMeta) depth++;
  }
  return depth;
}

export async function readIndex(): Promise<MiniAppIndexEntry[]> {
  const raw = await AsyncStorage.getItem(MINIAPP_INDEX_STORAGE_KEY);
  if (!raw) return [];
  let entries: MiniAppIndexEntry[];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    entries = parsed.filter(
      (e): e is MiniAppIndexEntry =>
        !!e &&
        typeof e.id === "string" &&
        typeof e.chatId === "string" &&
        typeof e.name === "string" &&
        typeof e.emoji === "string" &&
        typeof e.version === "number" &&
        typeof e.updatedAt === "number",
    );
  } catch {
    return [];
  }

  // Backfill historyDepth from disk for every entry so consumers always
  // see a fresh value. Cheap: one readdir per app, all parallelized.
  const depths = await Promise.all(
    entries.map((entry) => countHistoryDepth(entry.id).catch(() => 0)),
  );
  return entries.map((entry, i) => ({ ...entry, historyDepth: depths[i] }));
}

export async function writeIndex(entries: MiniAppIndexEntry[]): Promise<void> {
  await AsyncStorage.setItem(MINIAPP_INDEX_STORAGE_KEY, JSON.stringify(entries));
}

export async function upsertIndexEntry(
  entry: MiniAppIndexEntry,
): Promise<MiniAppIndexEntry[]> {
  const current = await readIndex();
  const next = [...current];
  // Always recompute historyDepth from disk on every write — callers can't
  // be trusted to supply a fresh value, and the count on disk is cheap.
  const historyDepth = await countHistoryDepth(entry.id).catch(() => 0);
  const stamped: MiniAppIndexEntry = { ...entry, historyDepth };
  const idx = next.findIndex((e) => e.id === entry.id);
  if (idx >= 0) {
    next[idx] = stamped;
  } else {
    next.push(stamped);
  }
  await writeIndex(next);
  return next;
}

export async function removeIndexEntry(
  appId: string,
): Promise<MiniAppIndexEntry[]> {
  const current = await readIndex();
  const next = current.filter((e) => e.id !== appId);
  if (next.length !== current.length) {
    await writeIndex(next);
  }
  return next;
}

export async function getAppIdForChat(
  chatId: string,
): Promise<string | null> {
  const index = await readIndex();
  const entry = index.find((e) => e.chatId === chatId);
  return entry?.id ?? null;
}

export async function deleteAppsForChat(chatId: string): Promise<void> {
  const index = await readIndex();
  const appsToDelete = index.filter((e) => e.chatId === chatId);
  for (const app of appsToDelete) {
    await deleteApp(app.id);
  }
}
