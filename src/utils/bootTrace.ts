import { useSyncExternalStore } from 'react';
import * as FileSystem from 'expo-file-system/legacy';

const MAX_BOOT_TRACE_STEPS = 24;
const BOOT_TRACE_FILE_URI = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}boot-trace.log`
  : null;

let bootTraceWritePromise: Promise<void> = Promise.resolve();

interface BootTraceStore {
  startedAt: number;
  steps: string[];
  listeners: Set<() => void>;
}

declare global {
  var __tensorchatBootTraceStore: BootTraceStore | undefined;
}

function getStore(): BootTraceStore {
  if (!globalThis.__tensorchatBootTraceStore) {
    globalThis.__tensorchatBootTraceStore = {
      startedAt: Date.now(),
      steps: [],
      listeners: new Set(),
    };
  }

  return globalThis.__tensorchatBootTraceStore;
}

function formatElapsedMs(elapsedMs: number): string {
  const wholeSeconds = Math.floor(elapsedMs / 1000);
  const remainingMs = elapsedMs % 1000;

  return `+${wholeSeconds}.${String(remainingMs).padStart(3, '0')}s`;
}

function appendBootTraceFile(entry: string): void {
  if (!BOOT_TRACE_FILE_URI) {
    return;
  }

  bootTraceWritePromise = bootTraceWritePromise
    .catch(() => undefined)
    .then(() =>
      FileSystem.writeAsStringAsync(
        BOOT_TRACE_FILE_URI,
        `${entry}\n`,
        {
          encoding: FileSystem.EncodingType.UTF8,
          append: true,
        },
      ),
    )
    .catch((error) => {
      console.warn('[BootTrace] Failed to append boot trace file:', error);
    });
}

export function logBootStep(step: string): void {
  const store = getStore();
  const entry = `${formatElapsedMs(Date.now() - store.startedAt)} ${step}`;

  store.steps = [...store.steps.slice(-(MAX_BOOT_TRACE_STEPS - 1)), entry];
  console.log(`[BootTrace] ${entry}`);
  appendBootTraceFile(`[BootTrace][JS] ${entry}`);

  for (const listener of store.listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  const store = getStore();
  store.listeners.add(listener);

  return () => {
    store.listeners.delete(listener);
  };
}

function getSnapshot(): readonly string[] {
  return getStore().steps;
}

export function useBootTraceSteps(): readonly string[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}