import AsyncStorage from "@react-native-async-storage/async-storage";
import RNFS from "react-native-fs";
import type { ImageGenResult } from "../types/imageGen";

const GALLERY_INDEX_KEY = "imagegen:gallery";
const IMAGEGEN_DIR_NAME = "imagegen";
const IMAGEGEN_DIR = `${RNFS.DocumentDirectoryPath}/${IMAGEGEN_DIR_NAME}`;

const listeners = new Set<(items: ImageGenResult[]) => void>();
let cache: ImageGenResult[] | null = null;

/**
 * Convert a stored `imagePath` to an absolute filesystem path.
 *
 * Items written by older builds store an absolute path that includes the
 * iOS app container UUID; that UUID changes on each reinstall, so the
 * absolute path becomes stale. New items store a path relative to
 * `DocumentDirectoryPath` (e.g. `imagegen/<id>.bmp`); we resolve it
 * against the *current* documents directory at read time.
 *
 * `imagePath` is treated as relative if it does not start with `/`. For
 * legacy absolute paths we extract the basename and re-resolve under the
 * current `imagegen/` directory — that covers the iOS-container-UUID
 * shuffle case for free.
 */
export function resolveImageGenPath(imagePath: string): string {
  if (!imagePath) return imagePath;
  if (!imagePath.startsWith("/")) {
    return `${RNFS.DocumentDirectoryPath}/${imagePath}`;
  }
  // Absolute legacy path. If the file still exists at the recorded
  // location, use it; otherwise re-resolve via the basename under the
  // current Documents/imagegen.
  const lastSlash = imagePath.lastIndexOf("/");
  const basename = lastSlash >= 0 ? imagePath.slice(lastSlash + 1) : imagePath;
  return `${IMAGEGEN_DIR}/${basename}`;
}

/**
 * Normalize a result for persistence — strips any absolute prefix off
 * `imagePath` so we never write container-UUID-dependent paths back to
 * AsyncStorage.
 */
function normalizeForStorage(item: ImageGenResult): ImageGenResult {
  if (!item.imagePath || !item.imagePath.startsWith("/")) {
    return item;
  }
  const idx = item.imagePath.indexOf(`/${IMAGEGEN_DIR_NAME}/`);
  if (idx >= 0) {
    return { ...item, imagePath: item.imagePath.slice(idx + 1) };
  }
  // Not under our imagegen dir for whatever reason — keep as-is.
  return item;
}

async function ensureDir(): Promise<void> {
  const exists = await RNFS.exists(IMAGEGEN_DIR);
  if (!exists) {
    await RNFS.mkdir(IMAGEGEN_DIR);
  }
}

async function readIndex(): Promise<ImageGenResult[]> {
  if (cache) {
    return cache;
  }
  try {
    const raw = await AsyncStorage.getItem(GALLERY_INDEX_KEY);
    if (!raw) {
      cache = [];
      return cache;
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      cache = [];
      return cache;
    }
    // Migrate any legacy absolute paths to relative form. The on-disk JSON
    // gets rewritten lazily on the next write; we don't force-flush here.
    cache = (parsed as ImageGenResult[]).map(normalizeForStorage);
    return cache;
  } catch (err) {
    console.warn("[imageGenStorage] failed to read gallery index", err);
    cache = [];
    return cache;
  }
}

async function writeIndex(items: ImageGenResult[]): Promise<void> {
  // Always normalize to relative paths before persisting.
  const normalized = items.map(normalizeForStorage);
  cache = normalized;
  await AsyncStorage.setItem(GALLERY_INDEX_KEY, JSON.stringify(normalized));
  listeners.forEach((listener) => listener(normalized));
}

export async function loadGallery(): Promise<ImageGenResult[]> {
  await ensureDir();
  return readIndex();
}

export async function saveGalleryItem(item: ImageGenResult): Promise<void> {
  const items = await readIndex();
  // Newest first.
  const next = [item, ...items.filter((existing) => existing.id !== item.id)];
  await writeIndex(next);
}

export async function deleteGalleryItem(id: string): Promise<void> {
  const items = await readIndex();
  const target = items.find((item) => item.id === id);
  const next = items.filter((item) => item.id !== id);
  await writeIndex(next);
  if (target?.imagePath) {
    await RNFS.unlink(resolveImageGenPath(target.imagePath)).catch(() => {});
  }
}

export async function clearGallery(): Promise<void> {
  const items = await readIndex();
  await writeIndex([]);
  await Promise.all(
    items.map((item) =>
      item.imagePath
        ? RNFS.unlink(resolveImageGenPath(item.imagePath)).catch(() => {})
        : Promise.resolve(),
    ),
  );
}

export function subscribeToGallery(
  listener: (items: ImageGenResult[]) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getImageGenDir(): string {
  return IMAGEGEN_DIR;
}
