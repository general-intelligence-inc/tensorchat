import * as Device from "expo-device";
import type { ModelConfig } from "../constants/models";

const BYTES_PER_GIB = 1024 * 1024 * 1024;
const BYTES_PER_MIB = 1024 * 1024;

export const MODEL_RAM_LIMIT_RATIO = 0.5;

export interface ModelMemoryEligibility {
  totalMemoryBytes: number | null;
  limitBytes: number | null;
  requiredBytes: number;
  allowed: boolean;
}

function isValidMemoryValue(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function getDeviceTotalMemoryBytes(): number | null {
  return isValidMemoryValue(Device.totalMemory) ? Device.totalMemory : null;
}

export function getEstimatedModelMemoryBytes(
  model: Pick<ModelConfig, "sizeGB" | "mmprojSizeGB">,
): number {
  return Math.round((model.sizeGB + (model.mmprojSizeGB ?? 0)) * BYTES_PER_GIB);
}

export function getDeviceModelMemoryLimitBytes(
  totalMemoryBytes: number | null = getDeviceTotalMemoryBytes(),
): number | null {
  if (!isValidMemoryValue(totalMemoryBytes)) {
    return null;
  }

  return Math.floor(totalMemoryBytes * MODEL_RAM_LIMIT_RATIO);
}

export function getModelMemoryEligibility(
  model: Pick<ModelConfig, "sizeGB" | "mmprojSizeGB">,
  totalMemoryBytes: number | null = getDeviceTotalMemoryBytes(),
): ModelMemoryEligibility {
  const requiredBytes = getEstimatedModelMemoryBytes(model);
  const limitBytes = getDeviceModelMemoryLimitBytes(totalMemoryBytes);

  return {
    totalMemoryBytes,
    limitBytes,
    requiredBytes,
    allowed: limitBytes === null || requiredBytes <= limitBytes,
  };
}

export function isModelAllowedByDeviceMemory(
  model: Pick<ModelConfig, "sizeGB" | "mmprojSizeGB">,
  totalMemoryBytes: number | null = getDeviceTotalMemoryBytes(),
): boolean {
  return getModelMemoryEligibility(model, totalMemoryBytes).allowed;
}

export function formatMemoryBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 MB";
  }

  const gib = bytes / BYTES_PER_GIB;
  if (gib >= 1) {
    return `~${gib >= 10 ? gib.toFixed(0) : gib.toFixed(1)} GB`;
  }

  return `~${Math.round(bytes / BYTES_PER_MIB)} MB`;
}

export function getModelMemoryBlockReason(
  model: Pick<ModelConfig, "sizeGB" | "mmprojSizeGB">,
  totalMemoryBytes: number | null = getDeviceTotalMemoryBytes(),
): string | null {
  const eligibility = getModelMemoryEligibility(model, totalMemoryBytes);

  if (eligibility.allowed || eligibility.limitBytes === null) {
    return null;
  }

  return `Needs ${formatMemoryBytes(eligibility.requiredBytes)} RAM. This device allows up to ${formatMemoryBytes(eligibility.limitBytes)}.`;
}

export function getDeviceMemorySummary(
  totalMemoryBytes: number | null = getDeviceTotalMemoryBytes(),
): string | null {
  const limitBytes = getDeviceModelMemoryLimitBytes(totalMemoryBytes);

  if (!isValidMemoryValue(totalMemoryBytes) || limitBytes === null) {
    return null;
  }

  return `This device has ${formatMemoryBytes(totalMemoryBytes)} RAM. Limit: ${formatMemoryBytes(limitBytes)}.`;
}

/**
 * Compute optimal `initLlama` parameters based on model size and platform.
 *
 * - KV cache quantization (q8_0) halves cache memory vs f16 for models >= 1.5 GB.
 * - Flash attention reduces peak memory during attention computation.
 * - GPU offloading on iOS shifts work to Metal, freeing CPU RAM.
 * - Memory mapping avoids contiguous allocation spikes during loading.
 */
export function buildOptimizedInitParams(opts: {
  modelSizeGB: number;
  platform: string;
}): {
  cache_type_k?: string;
  cache_type_v?: string;
  flash_attn_type?: string;
  use_mmap?: boolean;
} {
  const params: {
    cache_type_k?: string;
    cache_type_v?: string;
    flash_attn_type?: string;
    use_mmap?: boolean;
  } = {};

  // KV cache quantization: q8_0 for models >= 1.5 GB saves ~50% cache RAM
  // with minimal quality loss. Smaller models keep f16 for best quality.
  if (opts.modelSizeGB >= 1.5) {
    params.cache_type_k = "q8_0";
    params.cache_type_v = "q8_0";
  }

  // Flash attention: let llama.cpp auto-detect support per architecture.
  params.flash_attn_type = "auto";

  // NOTE: n_gpu_layers is intentionally NOT set here. On Apple Silicon's
  // unified memory architecture, setting n_gpu_layers causes the model
  // weights to be malloc'd into Metal GPU buffers IN ADDITION to the
  // mmap'd/loaded copy — effectively doubling memory usage. llama.rn
  // handles Metal acceleration internally via ggml-metal without needing
  // explicit layer offloading.

  // Memory mapping reduces peak RAM during model loading by lazily
  // paging model data instead of requiring contiguous allocation.
  params.use_mmap = true;

  return params;
}