import * as FileSystem from "expo-file-system/legacy";
import {
  ALL_MODELS,
  MINIAPP_MODELS,
  TRANSLATION_MODELS,
  getModelById,
  getTranslationModelById,
  isLikelyCompleteModelFile,
  type ModelConfig,
} from "../constants/models";

/**
 * Preferred Mini Apps model — Qwen 3.5 4B Q4_K_M. Scored 20/21 (95%)
 * on the e2e test suite with thinking off (matching the 16k production
 * context). Falls back to Gemma E2B variants if the user hasn't
 * downloaded it.
 */
const MINIAPP_PREFERRED_MODEL_ID = "4B-Q4_K_M";

export const SELECTED_MODEL_KEY = "selected_model_id";
export const SELECTED_TRANSLATION_MODEL_KEY = "selected_translation_model_id";
const MODELS_DIR = FileSystem.documentDirectory + "models/";

export interface LoadableModelCandidate {
  model: ModelConfig;
  modelPath: string;
  mmprojPath?: string;
}

interface FindLoadableModelOptions {
  isModelEligible?: (model: ModelConfig) => boolean;
}

export async function resolveLoadableModelCandidate(
  model: ModelConfig,
): Promise<LoadableModelCandidate | null> {
  const modelPath = MODELS_DIR + model.filename;
  const info = await FileSystem.getInfoAsync(modelPath);
  const actualBytes = info.exists ? (info as { size?: number }).size ?? 0 : 0;

  if (!info.exists || !isLikelyCompleteModelFile(model, actualBytes)) {
    return null;
  }

  if (!model.mmprojFilename) {
    return {
      model,
      modelPath,
    };
  }

  const mmprojPath = MODELS_DIR + model.mmprojFilename;
  const mmprojInfo = await FileSystem.getInfoAsync(mmprojPath);

  if (!mmprojInfo.exists) {
    return null;
  }

  return {
    model,
    modelPath,
    mmprojPath,
  };
}

export async function findPreferredLoadableModelCandidate(
  savedModelId: string | null,
  options: FindLoadableModelOptions = {},
): Promise<LoadableModelCandidate | null> {
  const savedModel = savedModelId ? getModelById(savedModelId) : undefined;
  const orderedModels = savedModel
    ? [savedModel, ...ALL_MODELS.filter((model) => model.id !== savedModel.id)]
    : ALL_MODELS;

  for (const model of orderedModels) {
    if (options.isModelEligible && !options.isModelEligible(model)) {
      continue;
    }

    const candidate = await resolveLoadableModelCandidate(model);
    if (candidate) {
      return candidate;
    }
  }

  return null;
}

export async function findPreferredLoadableTranslationModelCandidate(
  savedModelId: string | null,
  options: FindLoadableModelOptions = {},
): Promise<LoadableModelCandidate | null> {
  const savedModel = savedModelId
    ? getTranslationModelById(savedModelId)
    : undefined;
  const orderedModels = savedModel
    ? [savedModel, ...TRANSLATION_MODELS.filter((model) => model.id !== savedModel.id)]
    : TRANSLATION_MODELS;

  for (const model of orderedModels) {
    if (options.isModelEligible && !options.isModelEligible(model)) {
      continue;
    }

    const candidate = await resolveLoadableModelCandidate(model);
    if (candidate) {
      return candidate;
    }
  }

  return null;
}

export async function findFirstLoadableModelCandidate(
  options: FindLoadableModelOptions = {},
): Promise<LoadableModelCandidate | null> {
  return findPreferredLoadableModelCandidate(null, options);
}

/**
 * Find a loadable model for Mini Apps mode. Preference order:
 *   1. The saved model from AsyncStorage (if still downloaded)
 *   2. Qwen 3.5 4B Q4_K_M (best mini-app performance without thinking)
 *   3. Any other qualifying model from MINIAPP_MODELS that's on disk
 *
 * The pool includes Qwen 3.5 4B AND Gemma 4 E2B variants — both
 * families were tested end-to-end against the 21-scenario suite.
 *
 * Callers should IGNORE the returned `mmprojPath` — miniapp mode never
 * loads vision, so it should pass `undefined` for mmproj at load time even
 * when the sidecar is on disk.
 */
export async function findPreferredLoadableMiniAppModelCandidate(
  savedModelId: string | null,
  options: FindLoadableModelOptions = {},
): Promise<LoadableModelCandidate | null> {
  const savedModel = savedModelId
    ? MINIAPP_MODELS.find((m) => m.id === savedModelId)
    : undefined;
  const preferred = MINIAPP_MODELS.find(
    (m) => m.id === MINIAPP_PREFERRED_MODEL_ID,
  );
  const orderedModels: ModelConfig[] = [];
  if (savedModel) orderedModels.push(savedModel);
  if (preferred && preferred.id !== savedModel?.id) {
    orderedModels.push(preferred);
  }
  for (const model of MINIAPP_MODELS) {
    if (orderedModels.some((m) => m.id === model.id)) continue;
    orderedModels.push(model);
  }

  for (const model of orderedModels) {
    if (options.isModelEligible && !options.isModelEligible(model)) {
      continue;
    }
    const candidate = await resolveLoadableModelCandidate(model);
    if (candidate) {
      return candidate;
    }
  }

  return null;
}