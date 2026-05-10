// Float16Array polyfill installed at the entry point (`index.ts` ->
// `src/imagegen/float16Polyfill.ts`). Importing it here too is a no-op
// belt-and-suspenders: ensures the polyfill is in place even if this hook
// is somehow loaded outside the normal entry chain. We also import the
// `float32ToFloat16Bits` helper from the same module so the FP16 packing
// logic lives next to the polyfill it depends on.
import { float32ToFloat16Bits } from "../imagegen/float16Polyfill";

import { useCallback, useRef, useState } from "react";
import { Platform } from "react-native";
import RNFS from "react-native-fs";
import {
  getImageGenModelById,
  IMAGE_GEN_MODELS,
  listModelAssetFiles,
  type ModelConfig,
} from "../constants/models";
import type {
  ImageGenProgress,
  ImageGenResult,
  ImageGenSettings,
} from "../types/imageGen";
import { saveGalleryItem } from "../utils/imageGenStorage";
import { optionalRequire } from "../utils/optionalRequire";
import {
  loadClipTokenizer,
  encodeClipText,
  CLIP_MAX_LENGTH,
  type ClipTokenizerData,
} from "../imagegen/clipTokenizer";
import {
  applyCfg,
  buildDdimTimesteps,
  ddimStep,
  fillGaussian,
  VAE_SCALING_FACTOR,
} from "../imagegen/ddimScheduler";
import { writeRgbTensorAsBmp } from "../imagegen/bitmapWriter";

// ---------------------------------------------------------------------------
// ONNX Runtime bridge (already bundled via onnxruntime-react-native, used by
// EmbeddingGemma + Kokoro TTS). We use it directly — no new native module.
// ---------------------------------------------------------------------------

type OrtModuleLike = typeof import("onnxruntime-react-native");
type OrtInferenceSession = import("onnxruntime-common").InferenceSession;
type OrtSessionOptions = import("onnxruntime-common").InferenceSession.SessionOptions;
type OrtTensor = import("onnxruntime-common").Tensor;

const ortModule: OrtModuleLike | null = optionalRequire<OrtModuleLike>(
  () => require("onnxruntime-react-native"),
);

const MODELS_DIR = `${RNFS.DocumentDirectoryPath}/models`;
const IMAGEGEN_OUT_DIR = `${RNFS.DocumentDirectoryPath}/imagegen`;

function modelFilePath(filename: string): string {
  return `${MODELS_DIR}/${filename}`;
}

// ---------------------------------------------------------------------------
// Stable Diffusion 1.5 constants — match the nmkd ONNX export.
// ---------------------------------------------------------------------------

const LATENT_CHANNELS = 4;
const LATENT_DOWNSAMPLE = 8; // 512x512 image -> 64x64 latents
const SD_DEFAULT_SIZE = 512;

interface LoadedSession {
  session: OrtInferenceSession;
  inputNames: readonly string[];
  outputNames: readonly string[];
}

type UnetActDtype = "float" | "float16";
type UnetTsDtype = "int32" | "int64" | "float" | "float16";

interface LoadedEngine {
  modelId: string;
  textEncoder: LoadedSession;
  unet: LoadedSession;
  vaeDecoder: LoadedSession;
  tokenizer: ClipTokenizerData;
  /** Cached after first successful UNet run so we don't retry every step. */
  unetTimestepDtype?: UnetTsDtype;
  /** "float" = fp32 inputs, "float16" = fp16 inputs. Detected on first run. */
  unetActivationDtype?: UnetActDtype;
  vaeActivationDtype?: "float" | "float16";
}

function getSessionOptions(): OrtSessionOptions {
  // CPU for v1. GPU acceleration via CoreML / NNAPI is a follow-up — SD 1.5
  // has many ops that aren't supported by those providers and we'd need
  // fallback handling, so the conservative path is CPU-only.
  return {
    executionProviders: ["cpu"],
    graphOptimizationLevel: "all",
  };
}

// ---------------------------------------------------------------------------
// Tensor helpers
// ---------------------------------------------------------------------------

function makeFloatTensor(
  ort: OrtModuleLike,
  data: Float32Array,
  dims: readonly number[],
): OrtTensor {
  return new ort.Tensor("float32", data, dims as number[]);
}

function makeFloat16Tensor(
  ort: OrtModuleLike,
  data: Float32Array,
  dims: readonly number[],
): OrtTensor {
  return new ort.Tensor("float16", float32ToFloat16Bits(data), dims as number[]);
}

function makeInt64Tensor(
  ort: OrtModuleLike,
  data: BigInt64Array,
  dims: readonly number[],
): OrtTensor {
  return new ort.Tensor("int64", data, dims as number[]);
}

function makeInt32Tensor(
  ort: OrtModuleLike,
  data: Int32Array,
  dims: readonly number[],
): OrtTensor {
  return new ort.Tensor("int32", data, dims as number[]);
}

function tensorAsFloat32(tensor: OrtTensor): Float32Array {
  if (tensor.type === "float32") {
    return tensor.data as Float32Array;
  }
  if (tensor.type === "float16") {
    // CRITICAL: `tensor.data` may be the polyfilled Float16Array, which is a
    // Proxy that intercepts `data[i]` reads and returns the *float value*
    // instead of the raw uint16 bits. We need the bits, not the floats.
    // Bypass the Proxy by creating a fresh Uint16Array view of the
    // underlying ArrayBuffer — that reads bytes directly.
    const data = tensor.data as { buffer: ArrayBufferLike; byteOffset?: number; length: number };
    const raw = new Uint16Array(
      data.buffer,
      data.byteOffset ?? 0,
      data.length,
    );
    return float16BitsToFloat32(raw);
  }
  throw new Error(`Unexpected tensor type from session: ${tensor.type}`);
}

function float16BitsToFloat32(half: Uint16Array): Float32Array {
  // Standard IEEE-754 half -> single conversion. `half[i]` reads raw uint16.
  const out = new Float32Array(half.length);
  const tmp = new ArrayBuffer(4);
  const u32 = new Uint32Array(tmp);
  const f32 = new Float32Array(tmp);
  for (let i = 0; i < half.length; i++) {
    const h = half[i];
    const sign = (h & 0x8000) << 16;
    const exp = (h & 0x7c00) >> 10;
    const mant = h & 0x03ff;
    let bits: number;
    if (exp === 0) {
      if (mant === 0) {
        bits = sign;
      } else {
        let m = mant;
        let e = -14;
        while ((m & 0x0400) === 0) {
          m <<= 1;
          e -= 1;
        }
        m &= 0x03ff;
        bits = sign | ((e + 127) << 23) | (m << 13);
      }
    } else if (exp === 0x1f) {
      bits = sign | 0x7f800000 | (mant << 13);
    } else {
      bits = sign | ((exp - 15 + 127) << 23) | (mant << 13);
    }
    u32[0] = bits >>> 0;
    out[i] = f32[0];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseImageGenReturn {
  /** Whether the underlying ORT runtime is available (always false on web). */
  isEngineConfigured: boolean;
  /** Whether the bridge is available at all (true on iOS+Android, false on web). */
  isAvailable: boolean;
  isLoading: boolean;
  isGenerating: boolean;
  loadedModelId: string | null;
  error: string | null;
  progress: ImageGenProgress | null;
  isModelDownloaded: (model: ModelConfig) => Promise<boolean>;
  loadModel: (model: ModelConfig) => Promise<boolean>;
  unloadModel: () => Promise<void>;
  generate: (
    prompt: string,
    settings?: ImageGenSettings,
  ) => Promise<ImageGenResult | null>;
  cancel: () => Promise<void>;
}

const DEFAULT_STEPS = 20;
const DEFAULT_CFG_SCALE = 7.5;

export function useImageGen(): UseImageGenReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [loadedModelId, setLoadedModelId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ImageGenProgress | null>(null);

  // contextBusyRef serializes load/generate against startup auto-load races,
  // mirroring the same pattern in useLlama.
  const busyRef = useRef(false);
  const cancelRef = useRef(false);
  const engineRef = useRef<LoadedEngine | null>(null);

  const isAvailable = !!ortModule && Platform.OS !== "web";
  const isEngineConfigured = isAvailable;

  const isModelDownloaded = useCallback(
    async (model: ModelConfig): Promise<boolean> => {
      const files = listModelAssetFiles(model);
      for (const file of files) {
        const exists = await RNFS.exists(modelFilePath(file.filename));
        if (!exists) return false;
      }
      return true;
    },
    [],
  );

  const loadModel = useCallback(
    async (model: ModelConfig): Promise<boolean> => {
      if (!ortModule || !isAvailable) {
        setError("ONNX Runtime is not available on this device.");
        return false;
      }
      if (busyRef.current) return false;
      if (engineRef.current?.modelId === model.id) return true;

      busyRef.current = true;
      setIsLoading(true);
      setError(null);
      try {
        const ready = await isModelDownloaded(model);
        if (!ready) {
          throw new Error(`Model "${model.name}" is not fully downloaded.`);
        }

        // Release any existing engine before loading the new one.
        if (engineRef.current) {
          await releaseEngine(engineRef.current);
          engineRef.current = null;
          setLoadedModelId(null);
        }

        const sessionOpts = getSessionOptions();
        const textEncoderPath = modelFilePath("sd15-onnx/text_encoder/model.onnx");
        const unetPath = modelFilePath("sd15-onnx/unet/model.onnx");
        const vaeDecoderPath = modelFilePath("sd15-onnx/vae_decoder/model.onnx");
        const vocabPath = modelFilePath("sd15-onnx/tokenizer/vocab.json");
        const mergesPath = modelFilePath("sd15-onnx/tokenizer/merges.txt");

        const [textEncoder, unet, vaeDecoder, tokenizer] = await Promise.all([
          ortModule.InferenceSession.create(textEncoderPath, sessionOpts),
          ortModule.InferenceSession.create(unetPath, sessionOpts),
          ortModule.InferenceSession.create(vaeDecoderPath, sessionOpts),
          loadClipTokenizer(vocabPath, mergesPath),
        ]);

        engineRef.current = {
          modelId: model.id,
          textEncoder: {
            session: textEncoder,
            inputNames: textEncoder.inputNames,
            outputNames: textEncoder.outputNames,
          },
          unet: {
            session: unet,
            inputNames: unet.inputNames,
            outputNames: unet.outputNames,
          },
          vaeDecoder: {
            session: vaeDecoder,
            inputNames: vaeDecoder.inputNames,
            outputNames: vaeDecoder.outputNames,
          },
          tokenizer,
        };
        setLoadedModelId(model.id);
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        return false;
      } finally {
        setIsLoading(false);
        busyRef.current = false;
      }
    },
    [isAvailable, isModelDownloaded],
  );

  const unloadModel = useCallback(async (): Promise<void> => {
    if (!engineRef.current) return;
    await releaseEngine(engineRef.current);
    engineRef.current = null;
    setLoadedModelId(null);
    setProgress(null);
  }, []);

  const generate = useCallback(
    async (
      prompt: string,
      settings?: ImageGenSettings,
    ): Promise<ImageGenResult | null> => {
      if (!ortModule) {
        setError("ONNX Runtime is not available on this device.");
        return null;
      }
      if (!engineRef.current) {
        setError("Load an image model before generating.");
        return null;
      }
      if (isGenerating) return null;

      const ort = ortModule;
      const engine = engineRef.current;
      const width = clampImageDim(settings?.width ?? SD_DEFAULT_SIZE);
      const height = clampImageDim(settings?.height ?? SD_DEFAULT_SIZE);
      const numSteps = Math.max(1, settings?.steps ?? DEFAULT_STEPS);
      const cfgScale = settings?.cfgScale ?? DEFAULT_CFG_SCALE;
      const seed = settings?.seed ?? Math.floor(Math.random() * 2 ** 31);
      const negativePrompt = settings?.negativePrompt ?? "";

      cancelRef.current = false;
      setIsGenerating(true);
      setError(null);
      setProgress({ step: 0, total: numSteps + 2, fraction: 0 }); // +2 for text-encode + vae-decode

      try {
        // ---------- 1. Encode prompt + negative prompt ----------
        setProgress({ step: 1, total: numSteps + 2, fraction: 1 / (numSteps + 2) });
        const condEmbeds = await runTextEncoder(ort, engine, prompt);
        if (cancelRef.current) return null;
        const uncondEmbeds = await runTextEncoder(ort, engine, negativePrompt);
        if (cancelRef.current) return null;

        // ---------- 2. Initialize latents ----------
        const latentH = Math.floor(height / LATENT_DOWNSAMPLE);
        const latentW = Math.floor(width / LATENT_DOWNSAMPLE);
        const latentSize = LATENT_CHANNELS * latentH * latentW;
        let latents = new Float32Array(latentSize);
        fillGaussian(latents, seed);

        const timesteps = buildDdimTimesteps(numSteps);
        const epsCondBuf = new Float32Array(latentSize);
        const epsUncondBuf = new Float32Array(latentSize);
        const epsBuf = new Float32Array(latentSize);
        let nextLatents = new Float32Array(latentSize);

        // ---------- 3. DDIM sampling loop ----------
        for (let i = 0; i < timesteps.length; i++) {
          if (cancelRef.current) return null;
          const t = timesteps[i];
          const tPrev = i + 1 < timesteps.length ? timesteps[i + 1] : -1;

          const epsCondTensor = await runUnet(
            ort,
            engine,
            latents,
            t,
            condEmbeds,
            latentH,
            latentW,
          );
          if (cancelRef.current) return null;
          epsCondBuf.set(tensorAsFloat32(epsCondTensor));

          const epsUncondTensor = await runUnet(
            ort,
            engine,
            latents,
            t,
            uncondEmbeds,
            latentH,
            latentW,
          );
          if (cancelRef.current) return null;
          epsUncondBuf.set(tensorAsFloat32(epsUncondTensor));

          applyCfg(epsCondBuf, epsUncondBuf, cfgScale, epsBuf);
          ddimStep(latents, epsBuf, t, tPrev, nextLatents);
          // Swap buffers: after this, `latents` holds the new state,
          // and the freed buffer is reused as next iteration's write
          // target. No allocation per step.
          const tmp = latents;
          latents = nextLatents;
          nextLatents = tmp;

          setProgress({
            step: i + 2,
            total: numSteps + 2,
            fraction: (i + 2) / (numSteps + 2),
          });
        }

        // ---------- 4. Scale latents and decode via VAE ----------
        if (cancelRef.current) return null;
        const decoderInput = new Float32Array(latentSize);
        for (let i = 0; i < latentSize; i++) {
          decoderInput[i] = latents[i] / VAE_SCALING_FACTOR;
        }
        const rgbTensor = await runVaeDecoder(
          ort,
          engine,
          decoderInput,
          latentH,
          latentW,
        );
        if (cancelRef.current) return null;
        const rgb = tensorAsFloat32(rgbTensor);

        // ---------- 5. Persist as BMP and register in gallery ----------
        // We write to the absolute path on disk but record only the
        // *relative* path in `imagePath`. Storing absolute paths is
        // brittle on iOS — the app container UUID changes on each
        // reinstall and stale absolute paths point at deleted folders.
        // See `resolveImageGenPath` in `imageGenStorage.ts`.
        await ensureDir(IMAGEGEN_OUT_DIR);
        const id = `img-${Date.now()}-${Math.floor(Math.random() * 1e6).toString(36)}`;
        const relativePath = `imagegen/${id}.bmp`;
        const outPath = `${IMAGEGEN_OUT_DIR}/${id}.bmp`;
        await writeRgbTensorAsBmp(rgb, width, height, outPath);

        const result: ImageGenResult = {
          id,
          imagePath: relativePath,
          prompt,
          modelId: engine.modelId,
          width,
          height,
          seed,
          createdAt: Date.now(),
          stub: false,
          settings: {
            ...settings,
            steps: numSteps,
            cfgScale,
            seed,
            width,
            height,
            negativePrompt,
          },
        };
        await saveGalleryItem(result);
        setProgress({ step: numSteps + 2, total: numSteps + 2, fraction: 1 });
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        return null;
      } finally {
        setIsGenerating(false);
        setProgress(null);
        cancelRef.current = false;
      }
    },
    [isGenerating],
  );

  const cancel = useCallback(async (): Promise<void> => {
    cancelRef.current = true;
  }, []);

  return {
    isEngineConfigured,
    isAvailable,
    isLoading,
    isGenerating,
    loadedModelId,
    error,
    progress,
    isModelDownloaded,
    loadModel,
    unloadModel,
    generate,
    cancel,
  };
}

// ---------------------------------------------------------------------------
// Inference helpers
// ---------------------------------------------------------------------------

async function runTextEncoder(
  ort: OrtModuleLike,
  engine: LoadedEngine,
  text: string,
): Promise<Float32Array> {
  const encoded = encodeClipText(text, engine.tokenizer);
  const inputName = engine.textEncoder.inputNames[0]; // typically "input_ids"
  // nmkd's optimized FP16 export uses int32 input_ids; HF's stock export
  // uses int64. Try int32 first and fall back to int64 on the specific
  // dtype-mismatch error so we work with both export styles.
  const feedsInt32: Record<string, OrtTensor> = {
    [inputName]: makeInt32Tensor(ort, encoded.inputIdsInt32, [1, CLIP_MAX_LENGTH]),
  };
  let outputs: Record<string, OrtTensor>;
  try {
    outputs = await engine.textEncoder.session.run(feedsInt32);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("data type") || msg.includes("int64")) {
      const feedsInt64: Record<string, OrtTensor> = {
        [inputName]: makeInt64Tensor(ort, encoded.inputIdsInt64, [1, CLIP_MAX_LENGTH]),
      };
      outputs = await engine.textEncoder.session.run(feedsInt64);
    } else {
      throw err;
    }
  }
  const out =
    outputs["last_hidden_state"] ??
    outputs[engine.textEncoder.outputNames[0]];
  if (!out) {
    throw new Error("Text encoder produced no output tensor.");
  }
  return tensorAsFloat32(out);
}

async function runUnet(
  ort: OrtModuleLike,
  engine: LoadedEngine,
  latents: Float32Array,
  timestep: number,
  encoderHiddenStates: Float32Array,
  latentH: number,
  latentW: number,
): Promise<OrtTensor> {
  const inputNames = engine.unet.inputNames;
  const sampleName = pickInputName(inputNames, ["sample"]);
  const timestepName = pickInputName(inputNames, ["timestep"]);
  const encoderName = pickInputName(inputNames, ["encoder_hidden_states"]);

  const sampleDims: number[] = [1, LATENT_CHANNELS, latentH, latentW];
  const condDims: number[] = [1, CLIP_MAX_LENGTH, 768];

  // Activation dtype (float vs float16) and timestep dtype (int32 / int64 /
  // float / float16) are all export-specific. nmkd's optimized FP16 export
  // fuses the timestep embedding so timestep is fed as fp16; HF's stock
  // export uses int64 timestep + fp32 activations; Olive optimizations
  // sometimes use int32 timestep. We probe combinations and cache the
  // working one on the engine after first success.
  const buildSampleFp32 = () => makeFloatTensor(ort, latents, sampleDims);
  const buildSampleFp16 = () => makeFloat16Tensor(ort, latents, sampleDims);
  const buildCondFp32 = () => makeFloatTensor(ort, encoderHiddenStates, condDims);
  const buildCondFp16 = () => makeFloat16Tensor(ort, encoderHiddenStates, condDims);
  const buildTimestep = (dtype: UnetTsDtype): OrtTensor => {
    switch (dtype) {
      case "int32":
        return new ort.Tensor("int32", Int32Array.from([timestep]), [1]);
      case "int64":
        return new ort.Tensor("int64", BigInt64Array.from([BigInt(timestep)]), [1]);
      case "float":
        return new ort.Tensor("float32", new Float32Array([timestep]), [1]);
      case "float16":
        return new ort.Tensor(
          "float16",
          float32ToFloat16Bits(new Float32Array([timestep])),
          [1],
        );
    }
  };

  const runOnce = async (
    actDtype: UnetActDtype,
    tsDtype: UnetTsDtype,
  ): Promise<Record<string, OrtTensor>> => {
    return engine.unet.session.run({
      [sampleName]: actDtype === "float16" ? buildSampleFp16() : buildSampleFp32(),
      [timestepName]: buildTimestep(tsDtype),
      [encoderName]: actDtype === "float16" ? buildCondFp16() : buildCondFp32(),
    });
  };

  // Fast path: both dtypes already known.
  if (engine.unetActivationDtype && engine.unetTimestepDtype) {
    const outputs = await runOnce(engine.unetActivationDtype, engine.unetTimestepDtype);
    return outputs[engine.unet.outputNames[0]];
  }

  // Discovery: try the most-likely combos first, then everything else.
  // Order matters — early hits avoid running a full UNet pass per probe.
  const combos: Array<[UnetActDtype, UnetTsDtype]> = [
    ["float16", "float16"], // nmkd FP16 (timestep fused as half-float)
    ["float16", "int32"], // some Olive FP16 exports
    ["float", "int64"], // HF Diffusers default
    ["float", "int32"],
    ["float", "float"], // float32 timestep variant
    ["float16", "int64"],
    ["float16", "float"],
    ["float", "float16"],
  ];
  let lastErr: unknown = null;
  for (const [act, ts] of combos) {
    try {
      const outputs = await runOnce(act, ts);
      engine.unetActivationDtype = act;
      engine.unetTimestepDtype = ts;
      return outputs[engine.unet.outputNames[0]];
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("data type") && !msg.includes("input data")) {
        // Not a dtype-mismatch error — fail fast.
        throw err;
      }
      lastErr = err;
    }
  }
  throw lastErr ?? new Error("UNet: no working input dtype combination.");
}

async function runVaeDecoder(
  ort: OrtModuleLike,
  engine: LoadedEngine,
  latents: Float32Array,
  latentH: number,
  latentW: number,
): Promise<OrtTensor> {
  const inputName = pickInputName(engine.vaeDecoder.inputNames, [
    "latent_sample",
    "latents",
    "sample",
  ]);
  const dims: number[] = [1, LATENT_CHANNELS, latentH, latentW];

  const runOnce = async (
    dtype: "float" | "float16",
  ): Promise<Record<string, OrtTensor>> => {
    return engine.vaeDecoder.session.run({
      [inputName]:
        dtype === "float16"
          ? makeFloat16Tensor(ort, latents, dims)
          : makeFloatTensor(ort, latents, dims),
    });
  };

  if (engine.vaeActivationDtype) {
    const outputs = await runOnce(engine.vaeActivationDtype);
    return outputs[engine.vaeDecoder.outputNames[0]];
  }

  for (const dtype of ["float16", "float"] as const) {
    try {
      const outputs = await runOnce(dtype);
      engine.vaeActivationDtype = dtype;
      return outputs[engine.vaeDecoder.outputNames[0]];
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("data type") && !msg.includes("input data")) {
        throw err;
      }
    }
  }
  throw new Error("VAE decoder: no working input dtype combination.");
}

function pickInputName(
  available: readonly string[],
  candidates: string[],
): string {
  for (const c of candidates) {
    if (available.includes(c)) return c;
  }
  // Fall back to first input — useful if the model's export uses a
  // non-standard name. Better to misroute than crash before showing the
  // tensor type mismatch in the resulting ORT error.
  if (available.length > 0) return available[0];
  throw new Error(`No matching input found among ${candidates.join(", ")}`);
}

async function releaseEngine(engine: LoadedEngine): Promise<void> {
  await Promise.all([
    engine.textEncoder.session.release().catch(() => {}),
    engine.unet.session.release().catch(() => {}),
    engine.vaeDecoder.session.release().catch(() => {}),
  ]);
}

async function ensureDir(path: string): Promise<void> {
  const exists = await RNFS.exists(path);
  if (!exists) {
    await RNFS.mkdir(path);
  }
}

function clampImageDim(d: number): number {
  // SD 1.5 must be a multiple of 8 (latent stride). Clamp to a sane range.
  const n = Math.round(d / 8) * 8;
  return Math.max(64, Math.min(1024, n));
}

// ---------------------------------------------------------------------------
// Helpers re-exported for screen consumers
// ---------------------------------------------------------------------------

export async function listDownloadedImageGenModels(): Promise<ModelConfig[]> {
  const downloaded: ModelConfig[] = [];
  for (const model of IMAGE_GEN_MODELS) {
    const files = listModelAssetFiles(model);
    let allPresent = true;
    for (const file of files) {
      const exists = await RNFS.exists(modelFilePath(file.filename));
      if (!exists) {
        allPresent = false;
        break;
      }
    }
    if (allPresent) downloaded.push(model);
  }
  return downloaded;
}

export function getImageGenModelByIdSafe(id: string | null): ModelConfig | undefined {
  if (!id) return undefined;
  return getImageGenModelById(id);
}
