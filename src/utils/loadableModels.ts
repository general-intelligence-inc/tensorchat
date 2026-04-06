import * as FileSystem from "expo-file-system/legacy";
import {
  ALL_MODELS,
  TRANSLATION_MODELS,
  getModelById,
  getTranslationModelById,
  isLikelyCompleteModelFile,
  type ModelConfig,
} from "../constants/models";

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