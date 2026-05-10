import { Platform } from "react-native";
import RNFS from "react-native-fs";
import {
  isLikelyCompleteModelFile,
  listModelAssetFiles,
  type ImageAssetFile,
  type ModelConfig,
} from "../constants/models";
import { getModelMemoryBlockReason } from "./modelMemory";

const MODELS_DIR = `${RNFS.DocumentDirectoryPath}/models`;
const BYTES_PER_GIB = 1024 * 1024 * 1024;
const MIN_FILE_BYTES = 32 * 1024 * 1024;
const MIN_VALID_SIZE_RATIO = 0.75;
// Sidecar files (tokenizers, configs) can be tiny — bypass the floor
// so a 1 KB tokenizer.json doesn't fail the size check.
const SIDECAR_MIN_BYTES_FLOOR = 256;

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

async function ensureParentDir(filePath: string): Promise<void> {
  const lastSlash = filePath.lastIndexOf("/");
  if (lastSlash <= 0) {
    return;
  }
  const parent = filePath.slice(0, lastSlash);
  const exists = await RNFS.exists(parent);
  if (!exists) {
    await RNFS.mkdir(parent);
  }
}

async function deleteIfExists(path: string): Promise<void> {
  await RNFS.unlink(path).catch(() => {});
}

async function verifyPrimaryFile(model: ModelConfig, filePath: string): Promise<void> {
  const stat = await RNFS.stat(filePath);
  if (!isLikelyCompleteModelFile(model, Number(stat.size))) {
    throw new Error("Model download is incomplete.");
  }
}

async function verifySidecarFile(asset: ImageAssetFile, filePath: string): Promise<void> {
  const stat = await RNFS.stat(filePath);
  const actualBytes = Number(stat.size);
  const expectedBytes = asset.sizeGB * BYTES_PER_GIB;
  // Sidecars range from multi-GB (Qwen text encoder) down to sub-KB
  // (tokenizer_config.json). For large declared sidecars (>= 32 MB) we
  // keep the 75%-of-expected check to detect truncation. For smaller
  // declared sidecars we just check the file exists and isn't empty —
  // any percentage check would false-positive on tiny configs whose
  // real size doesn't match round-number sizeGB approximations.
  const useFloorCheck = expectedBytes >= MIN_FILE_BYTES;
  const threshold = useFloorCheck
    ? Math.max(MIN_FILE_BYTES, expectedBytes * MIN_VALID_SIZE_RATIO)
    : SIDECAR_MIN_BYTES_FLOOR;

  if (!Number.isFinite(actualBytes) || actualBytes < threshold) {
    throw new Error(`Sidecar download is incomplete: ${asset.filename}.`);
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
  // Drive a single weighted-progress loop over every asset file the
  // model needs. The first entry is always the primary weights file
  // (matches the legacy single-file path); chat-vision adds an mmproj
  // sidecar; image-gen models add a UNet+VAE+text-encoder+tokenizer
  // bundle. Storage layout stays flat under MODELS_DIR — filenames may
  // contain slashes for diffusion bundles, in which case we mkdir -p
  // the parent before downloading.
  const assetFiles = listModelAssetFiles(model);
  const destPaths = assetFiles.map((asset) => modelFilePath(asset.filename));
  const totalSize = assetFiles.reduce((sum, asset) => sum + asset.sizeGB, 0);
  const safeTotal = totalSize > 0 ? totalSize : 1;

  await ensureModelsDir();
  for (const path of destPaths) {
    await ensureParentDir(path);
    await deleteIfExists(path);
  }

  publish({ status: "downloading", modelId, progress: 0 });

  try {
    let completedFraction = 0;
    for (let i = 0; i < assetFiles.length; i++) {
      const asset = assetFiles[i];
      const dest = destPaths[i];
      const fileWeight = asset.sizeGB / safeTotal;

      await downloadFileWithProgress({
        url: asset.url,
        destinationPath: dest,
        expectedBytes: asset.sizeGB * BYTES_PER_GIB,
        onProgress: (ratio) => {
          publish({
            status: "downloading",
            modelId,
            progress: Math.min(1, completedFraction + ratio * fileWeight),
          });
        },
      });

      if (i === 0) {
        await verifyPrimaryFile(model, dest);
      } else {
        await verifySidecarFile(asset, dest);
      }

      completedFraction += fileWeight;
      publish({
        status: "downloading",
        modelId,
        progress: Math.min(1, completedFraction),
      });
    }

    publish({ status: "completed", modelId });
  } catch (error) {
    for (const path of destPaths) {
      await deleteIfExists(path);
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
