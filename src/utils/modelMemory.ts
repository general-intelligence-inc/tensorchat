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

