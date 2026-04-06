import { Platform } from "react-native";
import RNFS from "react-native-fs";
import {
  isLikelyCompleteModelFile,
  type ModelConfig,
} from "../constants/models";
import { getModelMemoryBlockReason } from "./modelMemory";

const MODELS_DIR = `${RNFS.DocumentDirectoryPath}/models`;
const BYTES_PER_GIB = 1024 * 1024 * 1024;
const MIN_FILE_BYTES = 32 * 1024 * 1024;
const MIN_VALID_SIZE_RATIO = 0.75;

export type ModelDownloadState =
  | { status: "idle" }
  | { status: "downloading"; modelId: string; progress: number }
  | { status: "completed"; modelId: string }
  | { status: "failed"; modelId: string; message: string };

const IDLE_DOWNLOAD_STATE: ModelDownloadState = { status: "idle" };

const listeners = new Set<(state: ModelDownloadState) => void>();

let currentState: ModelDownloadState = IDLE_DOWNLOAD_STATE;
let activeDownloadPromise: Promise<void> | null = null;

function publish(nextState: ModelDownloadState): void {
  currentState = nextState;
  listeners.forEach((listener) => listener(nextState));
}

async function ensureModelsDir(): Promise<void> {
  const exists = await RNFS.exists(MODELS_DIR);
  if (!exists) {
    await RNFS.mkdir(MODELS_DIR);
  }
}

function modelFilePath(filename: string): string {
  return `${MODELS_DIR}/${filename}`;
}

async function deleteIfExists(path: string): Promise<void> {
  await RNFS.unlink(path).catch(() => {});
}

async function verifyModelFile(model: ModelConfig, filePath: string): Promise<void> {
  const stat = await RNFS.stat(filePath);
  if (!isLikelyCompleteModelFile(model, Number(stat.size))) {
    throw new Error("Model download is incomplete.");
  }
}

async function verifyMmprojFile(model: ModelConfig, filePath: string): Promise<void> {
  if (!model.mmprojSizeGB) {
    return;
  }

  const stat = await RNFS.stat(filePath);
  const actualBytes = Number(stat.size);
  const expectedBytes = model.mmprojSizeGB * BYTES_PER_GIB;
  const threshold = Math.max(MIN_FILE_BYTES, expectedBytes * MIN_VALID_SIZE_RATIO);

  if (!Number.isFinite(actualBytes) || actualBytes < threshold) {
    throw new Error("Vision projector download is incomplete.");
  }
}

async function downloadFileWithProgress({
  url,
  destinationPath,
  expectedBytes,
  onProgress,
}: {
  url: string;
  destinationPath: string;
  expectedBytes: number;
  onProgress: (progress: number) => void;
}): Promise<void> {
  let totalBytes = expectedBytes;

  const { jobId, promise } = RNFS.downloadFile({
    fromUrl: url,
    toFile: destinationPath,
    background: Platform.OS === "ios",
    discretionary: false,
    progressInterval: 50,
    begin: ({ contentLength }: { jobId: number; statusCode: number; contentLength: number; headers: Record<string, string> }) => {
      if (contentLength > 0) {
        totalBytes = contentLength;
      }
    },
    progress: ({ bytesWritten }: { jobId: number; contentLength: number; bytesWritten: number }) => {
      if (totalBytes <= 0) {
        return;
      }

      onProgress(Math.min(1, bytesWritten / totalBytes));
    },
  });

  try {
    const result = await promise;
    if (result.statusCode < 200 || result.statusCode >= 300) {
      throw new Error(`Unexpected status: ${result.statusCode}`);
    }
  } finally {
    if (Platform.OS === "ios") {
      try {
        RNFS.completeHandlerIOS(jobId);
      } catch {}
    }
  }
}

async function runModelDownload(model: ModelConfig): Promise<void> {
  const modelId = model.id;
  const destPath = modelFilePath(model.filename);
  const mmprojDestPath = model.mmprojFilename
    ? modelFilePath(model.mmprojFilename)
    : null;
  const totalSize = model.sizeGB + (model.mmprojSizeGB ?? 0);
  const modelWeight = model.sizeGB / totalSize;
  const mmprojWeight = 1 - modelWeight;

  await ensureModelsDir();
  await deleteIfExists(destPath);
  if (mmprojDestPath) {
    await deleteIfExists(mmprojDestPath);
  }

  publish({ status: "downloading", modelId, progress: 0 });

  try {
    await downloadFileWithProgress({
      url: model.downloadUrl,
      destinationPath: destPath,
      expectedBytes: model.sizeGB * BYTES_PER_GIB,
      onProgress: (ratio) => {
        publish({
          status: "downloading",
          modelId,
          progress: ratio * modelWeight,
        });
      },
    });
    await verifyModelFile(model, destPath);

    publish({ status: "downloading", modelId, progress: modelWeight });

    if (mmprojDestPath && model.mmprojUrl) {
      await downloadFileWithProgress({
        url: model.mmprojUrl,
        destinationPath: mmprojDestPath,
        expectedBytes: (model.mmprojSizeGB ?? 0) * BYTES_PER_GIB,
        onProgress: (ratio) => {
          publish({
            status: "downloading",
            modelId,
            progress: modelWeight + ratio * mmprojWeight,
          });
        },
      });
      await verifyMmprojFile(model, mmprojDestPath);
    }

    publish({ status: "completed", modelId });
  } catch (error) {
    await deleteIfExists(destPath);
    if (mmprojDestPath) {
      await deleteIfExists(mmprojDestPath);
    }

    const message = error instanceof Error ? error.message : String(error);
    publish({ status: "failed", modelId, message });
    throw error;
  }
}

export function getModelDownloadState(): ModelDownloadState {
  return currentState;
}

export function clearModelDownloadState(): void {
  if (currentState.status === "downloading") {
    return;
  }

  publish(IDLE_DOWNLOAD_STATE);
}

export function subscribeToModelDownloadState(
  listener: (state: ModelDownloadState) => void,
): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export function downloadCatalogModelInBackground(model: ModelConfig): Promise<void> {
  const blockedReason = getModelMemoryBlockReason(model);
  if (blockedReason) {
    return Promise.reject(new Error(blockedReason));
  }

  if (activeDownloadPromise) {
    if (currentState.status === "downloading" && currentState.modelId === model.id) {
      return activeDownloadPromise;
    }

    return Promise.reject(new Error("Another model download is already in progress."));
  }

  activeDownloadPromise = runModelDownload(model).finally(() => {
    activeDownloadPromise = null;
  });

  return activeDownloadPromise;
}

export const downloadChatModelInBackground = downloadCatalogModelInBackground;