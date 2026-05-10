/**
 * Shared types for the on-device image generation feature.
 *
 * Image generation runs through ONNX Runtime
 * (`onnxruntime-react-native`); the diffusion sampler loop, CLIP
 * tokenizer, and BMP encoder live under `src/imagegen/`. These types
 * describe the JS-layer representation of a generation job and its
 * persisted result.
 */

import type { ImageAssetFile } from "../constants/models";

export type ImageGenSampler =
  | "euler_a"
  | "dpmpp_2m"
  | "dpmpp_sde"
  | "lcm"
  | "turbo";

export interface ImageGenSettings {
  /** Number of denoising steps. Defaults vary by sampler / model. */
  steps?: number;
  /** Classifier-free guidance scale. */
  cfgScale?: number;
  seed?: number;
  width?: number;
  height?: number;
  negativePrompt?: string;
  sampler?: ImageGenSampler;
}

export interface ImageGenProgress {
  step: number;
  total: number;
  fraction: number;
}

export interface ImageGenResult {
  /** Stable id used as the gallery key and underlying filename stem. */
  id: string;
  /** Absolute on-disk path to the generated PNG. */
  imagePath: string;
  prompt: string;
  modelId: string;
  width: number;
  height: number;
  seed: number;
  /** Unix epoch ms — when the generation finished. */
  createdAt: number;
  /** True when produced by the stub Swift implementation (no real engine). */
  stub?: boolean;
  /** Optional negative prompt / sampler / cfg captured for reproduction. */
  settings?: ImageGenSettings;
}

export interface ImageGenJob {
  id: string;
  prompt: string;
  modelId: string;
  startedAt: number;
  settings: ImageGenSettings;
}

/**
 * On-disk asset list for a downloaded diffusion model — the union of the
 * primary `filename` and any sidecars from `assetFiles`. Used by the hook
 * when verifying readiness before load. Re-exported to keep imports
 * shallow for the screen layer.
 */
export type ImageGenAssetFile = ImageAssetFile;
