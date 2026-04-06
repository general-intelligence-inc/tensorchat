export type ChatQuantization = "Q3_K_M" | "Q4_K_M" | "Q8_0" | "BF16" | "UD_IQ2_M";

export type Quantization = ChatQuantization | "Q4_0";

export type ChatBaseModel = "0.8B" | "2B" | "4B" | "350M" | "1.2B" | "E2B";
export type AddonBaseModel = "embedding" | "translation";
export type ModelCatalogTab =
  | ChatBaseModel
  | "embedding"
  | "translation"
  | "voice";
export type ModelCatalogKind = "chat" | "embedding" | "translation";

interface ChatModelDefinition {
  quantization: ChatQuantization;
  sizeGB: number;
  recommended?: boolean;
  fast?: boolean;
}

interface ChatModelFamilyDefinition {
  baseModel: ChatBaseModel;
  title: string;
  subtitle: string;
  huggingFaceRepo: string;
  filePrefix: string;
  models: ReadonlyArray<ChatModelDefinition>;
  mmprojSizeGB?: number;
  supportsThinking?: boolean;
  alwaysThinks?: boolean;
  nativeReasoning?: boolean;
  supportsToolCalling?: boolean;
  isVisionModel?: boolean;
}

export interface ChatModelFamily {
  baseModel: ChatBaseModel;
  title: string;
  subtitle: string;
  models: ModelConfig[];
}

export interface ModelConfig {
  id: string;
  name: string;
  description: string;
  huggingFaceRepo: string;
  filename: string;
  downloadUrl: string;
  sizeGB: number;
  quantization: Quantization;
  baseModel: ChatBaseModel | AddonBaseModel;
  supportsThinking: boolean;
  alwaysThinks: boolean;
  nativeReasoning: boolean;
  supportsToolCalling: boolean;
  isVisionModel: boolean;
  catalogKind: ModelCatalogKind;
  recommended?: boolean;
  fast?: boolean;
  minimumBytes?: number;
  mmprojFilename?: string;
  mmprojUrl?: string;
  mmprojSizeGB?: number;
}

export interface ThinkingBudget {
  maxReasoningTokens: number;
  maxGenerationTokens: number;
  promptGuidance: string;
}

const BYTES_PER_GIB = 1024 * 1024 * 1024;
const MIN_MODEL_FILE_BYTES = 32 * 1024 * 1024;
const MIN_VALID_SIZE_RATIO = 0.75;

export const QUANTIZATIONS: ChatQuantization[] = ["Q3_K_M", "Q4_K_M", "Q8_0"];

export const QUANTIZATION_DISPLAY_LABELS: Record<Quantization, string> = {
  Q3_K_M: "Q3",
  Q4_K_M: "Q4",
  Q8_0: "Q8",
  BF16: "BF16",
  UD_IQ2_M: "IQ2",
  Q4_0: "Q4_0",
};

export const QUANTIZATION_LABELS: Record<Quantization, string> = {
  Q3_K_M: "Q3 (smallest 4B option)",
  Q4_K_M: "Q4",
  Q8_0: "Q8 (best quality, largest)",
  BF16: "BF16 (full precision)",
  UD_IQ2_M: "IQ2 (smallest E2B option)",
  Q4_0: "Q4_0",
};

const CHAT_MODEL_FAMILY_08B: ChatModelFamilyDefinition = {
  baseModel: "0.8B",
  title: "Qwen3.5-0.8B",
  subtitle: "Fast · less capable",
  huggingFaceRepo: "unsloth/Qwen3.5-0.8B-GGUF",
  filePrefix: "Qwen3.5-0.8B",
  models: [
    {
      quantization: "Q4_K_M",
      sizeGB: 0.53,
      recommended: true,
    },
    {
      quantization: "Q8_0",
      sizeGB: 0.81,
    },
  ],
  mmprojSizeGB: 0.21,
};

const CHAT_MODEL_FAMILY_2B: ChatModelFamilyDefinition = {
  baseModel: "2B",
  title: "Qwen3.5-2B",
  subtitle: "Smarter · needs more RAM",
  huggingFaceRepo: "unsloth/Qwen3.5-2B-GGUF",
  filePrefix: "Qwen3.5-2B",
  models: [
    {
      quantization: "Q4_K_M",
      sizeGB: 1.28,
      recommended: true,
    },
    {
      quantization: "Q8_0",
      sizeGB: 2.01,
    },
  ],
  mmprojSizeGB: 0.65,
};

const CHAT_MODEL_FAMILY_4B: ChatModelFamilyDefinition = {
  baseModel: "4B",
  title: "Qwen3.5-4B",
  subtitle: "Smartest · lots of RAM",
  huggingFaceRepo: "unsloth/Qwen3.5-4B-GGUF",
  filePrefix: "Qwen3.5-4B",
  models: [
    {
      quantization: "Q3_K_M",
      sizeGB: 2.29,
      recommended: true,
    },
    {
      quantization: "Q4_K_M",
      sizeGB: 2.74,
    },
  ],
  mmprojSizeGB: 0.66,
};

const CHAT_MODEL_FAMILY_E2B: ChatModelFamilyDefinition = {
  baseModel: "E2B",
  title: "Gemma 4 E2B",
  subtitle: "Google multimodal",
  huggingFaceRepo: "unsloth/gemma-4-E2B-it-GGUF",
  filePrefix: "gemma-4-E2B-it",
  models: [
    {
      quantization: "Q4_K_M",
      sizeGB: 3.11,
      recommended: true,
    },
  ],
  mmprojSizeGB: 0.96,
  nativeReasoning: true,
};

const CHAT_MODEL_FAMILY_350M: ChatModelFamilyDefinition = {
  baseModel: "350M",
  title: "LFM2.5-350M",
  subtitle: "Ultra-lightweight",
  huggingFaceRepo: "LiquidAI/LFM2.5-350M-GGUF",
  filePrefix: "LFM2.5-350M",
  models: [
    {
      quantization: "BF16",
      sizeGB: 0.85,
      recommended: true,
    },
  ],
  supportsThinking: false,
  isVisionModel: false,
};

const CHAT_MODEL_FAMILY_12B: ChatModelFamilyDefinition = {
  baseModel: "1.2B",
  title: "LFM2.5-1.2B",
  subtitle: "Instruct model",
  huggingFaceRepo: "LiquidAI/LFM2.5-1.2B-Instruct-GGUF",
  filePrefix: "LFM2.5-1.2B-Instruct",
  models: [
    {
      quantization: "Q8_0",
      sizeGB: 1.25,
      recommended: true,
    },
  ],
  supportsThinking: false,
  alwaysThinks: false,
  isVisionModel: false,
};

const THINKING_PROMPT_GUIDANCE =
  "Keep reasoning short, no repetition, and move to the answer as soon as you can.";

const THINKING_BUDGETS: Record<ChatBaseModel, ThinkingBudget> = {
  "0.8B": {
    maxReasoningTokens: 500,
    maxGenerationTokens: 1536,
    promptGuidance: THINKING_PROMPT_GUIDANCE,
  },
  "2B": {
    maxReasoningTokens: 500,
    maxGenerationTokens: 2048,
    promptGuidance: THINKING_PROMPT_GUIDANCE,
  },
  "4B": {
    maxReasoningTokens: 500,
    maxGenerationTokens: 2048,
    promptGuidance: THINKING_PROMPT_GUIDANCE,
  },
  "350M": {
    maxReasoningTokens: 500,
    maxGenerationTokens: 1024,
    promptGuidance: THINKING_PROMPT_GUIDANCE,
  },
  "1.2B": {
    maxReasoningTokens: 500,
    maxGenerationTokens: 2048,
    promptGuidance: THINKING_PROMPT_GUIDANCE,
  },
  E2B: {
    maxReasoningTokens: 500,
    maxGenerationTokens: 2048,
    promptGuidance: THINKING_PROMPT_GUIDANCE,
  },
};

function buildModels(family: ChatModelFamilyDefinition): ModelConfig[] {
  const hasVision = family.isVisionModel !== false;
  const hasThinking = family.supportsThinking !== false;
  const modelAlwaysThinks = family.alwaysThinks === true;
  const hasToolCalling = family.supportsToolCalling !== false;
  const mmprojFilename = hasVision
    ? `mmproj-${family.baseModel}-F16.gguf`
    : undefined;

  return family.models.map(({ quantization, sizeGB, recommended, fast }) => {
    const quantizationLabel = QUANTIZATION_LABELS[quantization];
    const description = recommended
      ? `${family.title} ${family.baseModel} parameter model, ${quantizationLabel} · recommended`
      : `${family.title} ${family.baseModel} parameter model, ${quantizationLabel}`;

    const config: ModelConfig = {
      id: `${family.baseModel}-${quantization}`,
      name: `${family.title} ${QUANTIZATION_DISPLAY_LABELS[quantization]}`,
      description,
      huggingFaceRepo: family.huggingFaceRepo,
      filename: `${family.filePrefix}-${quantization}.gguf`,
      downloadUrl: `https://huggingface.co/${family.huggingFaceRepo}/resolve/main/${family.filePrefix}-${quantization}.gguf`,
      sizeGB,
      quantization,
      baseModel: family.baseModel,
      supportsThinking: hasThinking,
      alwaysThinks: modelAlwaysThinks,
      nativeReasoning: family.nativeReasoning === true,
      supportsToolCalling: hasToolCalling,
      isVisionModel: hasVision,
      catalogKind: "chat",
      recommended,
      fast,
    };

    if (hasVision && family.mmprojSizeGB) {
      config.mmprojFilename = mmprojFilename;
      config.mmprojUrl = `https://huggingface.co/${family.huggingFaceRepo}/resolve/main/mmproj-F16.gguf`;
      config.mmprojSizeGB = family.mmprojSizeGB;
    }

    return config;
  });
}

export const MODELS_08B: ModelConfig[] = buildModels(CHAT_MODEL_FAMILY_08B);

export const MODELS_2B: ModelConfig[] = buildModels(CHAT_MODEL_FAMILY_2B);

export const MODELS_4B: ModelConfig[] = buildModels(CHAT_MODEL_FAMILY_4B);

const GEMMA_E2B_IQ2_MODEL: ModelConfig = {
  id: "E2B-UD_IQ2_M",
  name: "Gemma 4 E2B IQ2",
  description: "Gemma 4 E2B parameter model, IQ2 (smallest E2B option)",
  huggingFaceRepo: "unsloth/gemma-4-E2B-it-GGUF",
  filename: "gemma-4-E2B-it-UD-IQ2_M.gguf",
  downloadUrl:
    "https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF/resolve/main/gemma-4-E2B-it-UD-IQ2_M.gguf",
  sizeGB: 2.29,
  quantization: "UD_IQ2_M",
  baseModel: "E2B",
  supportsThinking: true,
  alwaysThinks: false,
  nativeReasoning: true,
  supportsToolCalling: true,
  isVisionModel: false,
  catalogKind: "chat",
};

export const MODELS_E2B: ModelConfig[] = [
  ...buildModels(CHAT_MODEL_FAMILY_E2B),
  GEMMA_E2B_IQ2_MODEL,
];

export const MODELS_350M: ModelConfig[] = buildModels(CHAT_MODEL_FAMILY_350M);

export const MODELS_12B: ModelConfig[] = buildModels(CHAT_MODEL_FAMILY_12B);

export const CHAT_MODEL_FAMILIES: ChatModelFamily[] = [
  {
    baseModel: CHAT_MODEL_FAMILY_350M.baseModel,
    title: CHAT_MODEL_FAMILY_350M.title,
    subtitle: CHAT_MODEL_FAMILY_350M.subtitle,
    models: MODELS_350M,
  },
  {
    baseModel: CHAT_MODEL_FAMILY_08B.baseModel,
    title: CHAT_MODEL_FAMILY_08B.title,
    subtitle: CHAT_MODEL_FAMILY_08B.subtitle,
    models: MODELS_08B,
  },
  {
    baseModel: CHAT_MODEL_FAMILY_12B.baseModel,
    title: CHAT_MODEL_FAMILY_12B.title,
    subtitle: CHAT_MODEL_FAMILY_12B.subtitle,
    models: MODELS_12B,
  },
  {
    baseModel: CHAT_MODEL_FAMILY_2B.baseModel,
    title: CHAT_MODEL_FAMILY_2B.title,
    subtitle: CHAT_MODEL_FAMILY_2B.subtitle,
    models: MODELS_2B,
  },
  {
    baseModel: CHAT_MODEL_FAMILY_4B.baseModel,
    title: CHAT_MODEL_FAMILY_4B.title,
    subtitle: CHAT_MODEL_FAMILY_4B.subtitle,
    models: MODELS_4B,
  },
  {
    baseModel: CHAT_MODEL_FAMILY_E2B.baseModel,
    title: CHAT_MODEL_FAMILY_E2B.title,
    subtitle: CHAT_MODEL_FAMILY_E2B.subtitle,
    models: MODELS_E2B,
  },
];

const CHAT_MODELS_BY_BASE: Record<ChatBaseModel, ModelConfig[]> = {
  "350M": MODELS_350M,
  "0.8B": MODELS_08B,
  "1.2B": MODELS_12B,
  "2B": MODELS_2B,
  "4B": MODELS_4B,
  E2B: MODELS_E2B,
};

export const ALL_MODELS: ModelConfig[] = [
  ...MODELS_350M,
  ...MODELS_08B,
  ...MODELS_12B,
  ...MODELS_2B,
  ...MODELS_4B,
  ...MODELS_E2B,
];

export const EMBEDDING_MODEL_ID = "embedding-gemma-300m-q4_0";
export const EMBEDDING_MODEL_FILENAME = "embeddinggemma-300m-Q4_0.gguf";
export const EMBEDDING_MODEL_URL =
  "https://huggingface.co/unsloth/embeddinggemma-300m-GGUF/resolve/main/embeddinggemma-300m-Q4_0.gguf?download=true";
export const EMBEDDING_MODEL_EXPECTED_BYTES = 277_852_192;
export const EMBEDDING_MODEL_MINIMUM_BYTES = Math.floor(
  EMBEDDING_MODEL_EXPECTED_BYTES * 0.95,
);

export const EMBEDDING_MODEL: ModelConfig = {
  id: EMBEDDING_MODEL_ID,
  name: "EmbeddingGemma 300M",
  description: "On-device embedding model used by File Vault retrieval.",
  huggingFaceRepo: "unsloth/embeddinggemma-300m-GGUF",
  filename: EMBEDDING_MODEL_FILENAME,
  downloadUrl: EMBEDDING_MODEL_URL,
  sizeGB: EMBEDDING_MODEL_EXPECTED_BYTES / BYTES_PER_GIB,
  quantization: "Q4_0",
  baseModel: "embedding",
  supportsThinking: false,
  alwaysThinks: false,
  nativeReasoning: false,
  supportsToolCalling: false,
  isVisionModel: false,
  catalogKind: "embedding",
  minimumBytes: EMBEDDING_MODEL_MINIMUM_BYTES,
};

export const EMBEDDING_MODELS: ModelConfig[] = [EMBEDDING_MODEL];

export const EURO_LLM_TRANSLATION_MODEL_ID = "translation-eurollm-1.7b-q4_k_m";
export const EURO_LLM_TRANSLATION_MODEL_FILENAME =
  "EuroLLM-1.7B-Instruct.Q4_K_M.gguf";
export const EURO_LLM_TRANSLATION_MODEL_URL =
  "https://huggingface.co/mradermacher/EuroLLM-1.7B-Instruct-GGUF/resolve/main/EuroLLM-1.7B-Instruct.Q4_K_M.gguf?download=true";

export const EURO_LLM_TRANSLATION_MODEL: ModelConfig = {
  id: EURO_LLM_TRANSLATION_MODEL_ID,
  name: "EuroLLM 1.7B Q4",
  description:
    "Translation model tuned for most popular languages.",
  huggingFaceRepo: "mradermacher/EuroLLM-1.7B-Instruct-GGUF",
  filename: EURO_LLM_TRANSLATION_MODEL_FILENAME,
  downloadUrl: EURO_LLM_TRANSLATION_MODEL_URL,
  sizeGB: 1.05,
  quantization: "Q4_K_M",
  baseModel: "translation",
  supportsThinking: false,
  alwaysThinks: false,
  nativeReasoning: false,
  supportsToolCalling: false,
  isVisionModel: false,
  catalogKind: "translation",
  // recommended: true,
  fast: true,
};

export const TRANSLATE_GEMMA_TRANSLATION_MODEL_ID =
  "translation-translategemma-4b-it-q3_k_m";
export const TRANSLATE_GEMMA_TRANSLATION_MODEL_FILENAME =
  "translategemma-4b-it.Q3_K_M.gguf";
export const TRANSLATE_GEMMA_TRANSLATION_MODEL_URL =
  "https://huggingface.co/mradermacher/translategemma-4b-it-GGUF/resolve/main/translategemma-4b-it.Q3_K_M.gguf?download=true";

export const TRANSLATE_GEMMA_TRANSLATION_MODEL: ModelConfig = {
  id: TRANSLATE_GEMMA_TRANSLATION_MODEL_ID,
  name: "TranslateGemma 4B Q3",
  description: "On-device translation model based on Google Gemma.",
  huggingFaceRepo: "mradermacher/translategemma-4b-it-GGUF",
  filename: TRANSLATE_GEMMA_TRANSLATION_MODEL_FILENAME,
  downloadUrl: TRANSLATE_GEMMA_TRANSLATION_MODEL_URL,
  sizeGB: 2.1,
  quantization: "Q3_K_M",
  baseModel: "translation",
  supportsThinking: false,
  alwaysThinks: false,
  nativeReasoning: false,
  supportsToolCalling: false,
  isVisionModel: false,
  catalogKind: "translation",
  recommended: true,
};

export const TRANSLATION_MODELS: ModelConfig[] = [
  EURO_LLM_TRANSLATION_MODEL,
  TRANSLATE_GEMMA_TRANSLATION_MODEL,
];

export const DEFAULT_TRANSLATION_MODEL_ID = TRANSLATION_MODELS[0].id;
export const DEFAULT_TRANSLATION_MODEL = TRANSLATION_MODELS[0];
export const CATALOG_MODELS: ModelConfig[] = [
  ...ALL_MODELS,
  ...EMBEDDING_MODELS,
  ...TRANSLATION_MODELS,
];

export const DEFAULT_THINKING_BUDGET: ThinkingBudget = THINKING_BUDGETS["0.8B"];

export const DEFAULT_MODEL_ID = "0.8B-Q4_K_M";

export function getChatModelsForBase(baseModel: ChatBaseModel): ModelConfig[] {
  return CHAT_MODELS_BY_BASE[baseModel];
}

export function getModelById(id: string): ModelConfig | undefined {
  return ALL_MODELS.find((m) => m.id === id);
}

export function getCatalogModelById(id: string): ModelConfig | undefined {
  return CATALOG_MODELS.find((model) => model.id === id);
}

export function getTranslationModelById(id: string): ModelConfig | undefined {
  return TRANSLATION_MODELS.find((model) => model.id === id);
}

export function getTranslationModelByPath(
  modelPath?: string | null,
): ModelConfig | undefined {
  if (!modelPath) {
    return undefined;
  }

  return TRANSLATION_MODELS.find((model) => modelPath.endsWith(model.filename));
}

export function getThinkingBudgetForModel(
  model?: Pick<ModelConfig, "baseModel"> | null,
): ThinkingBudget {
  const budget =
    model && isChatBaseModel(model.baseModel)
      ? THINKING_BUDGETS[model.baseModel]
      : DEFAULT_THINKING_BUDGET;
  return { ...budget };
}

function isChatBaseModel(
  baseModel: ModelConfig["baseModel"],
): baseModel is ChatBaseModel {
  return (
    baseModel === "350M" ||
    baseModel === "0.8B" ||
    baseModel === "1.2B" ||
    baseModel === "2B" ||
    baseModel === "4B" ||
    baseModel === "E2B"
  );
}

export function isLikelyCompleteModelFile(
  model: ModelConfig,
  actualBytes: number,
): boolean {
  if (!Number.isFinite(actualBytes) || actualBytes <= 0) {
    return false;
  }

  if (model.minimumBytes) {
    return actualBytes >= model.minimumBytes;
  }

  const expectedBytes = model.sizeGB * BYTES_PER_GIB;
  if (!Number.isFinite(expectedBytes) || expectedBytes <= 0) {
    return actualBytes >= MIN_MODEL_FILE_BYTES;
  }

  const minExpectedBytes = expectedBytes * MIN_VALID_SIZE_RATIO;
  const threshold = Math.max(MIN_MODEL_FILE_BYTES, minExpectedBytes);
  return actualBytes >= threshold;
}
