export type ChatQuantization = "Q3_K_M" | "Q4_K_M" | "Q8_0" | "BF16" | "UD_IQ2_M";

export type Quantization = ChatQuantization | "Q4_0";

export type ChatBaseModel = "0.8B" | "2B" | "4B" | "350M" | "1.2B" | "E2B";
export type AddonBaseModel = "embedding" | "translation";
export type ModelCatalogTab =
  | ChatBaseModel
  | "embedding"
  | "translation"
  | "voice"
  | "downloaded";
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

/**
 * Models eligible for the Mini Apps builder. Tested end-to-end against
 * the full 21-scenario e2e suite (scripts/test-miniapp-e2e.ts) with
 * thinking OFF (matching the production 16k context budget):
 *
 *   Qwen 3.5 4B Q4_K_M — 20/21 (95%)  ← best without thinking
 *   Gemma 4 E2B Q4_K_M — 16/21 (76%)
 *   Gemma 4 E2B IQ2_M  — excluded, too unreliable for mini-app generation
 *   Qwen 3.5 2B Q4_K_M — 12/21 (57%)  ← excluded, too unreliable
 *
 * Order matters: the first model the user has downloaded becomes the
 * preferred fallback via `findPreferredLoadableMiniAppModelCandidate`.
 * Qwen 4B Q4 is listed first (best quality), followed by E2B Q4_K_M.
 */
export const MINIAPP_MODELS: ModelConfig[] = [
  // Qwen 3.5 4B — highest success rate without thinking mode.
  // Only Q4_K_M (2.74 GB) — Q3_K_M showed no difference in our eval
  // and the user already has the Q4 downloaded in most cases.
  ...MODELS_4B.filter((m) => m.quantization === "Q4_K_M"),
  // Gemma 4 E2B Q4_K_M only — IQ2_M is too unreliable for mini-app
  // generation (produces malformed tool calls and truncated programs).
  ...MODELS_E2B.filter((m) => m.quantization !== "UD_IQ2_M"),
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

const QWEN_SVG = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12.604 1.34c.393.69.784 1.382 1.174 2.075a.18.18 0 00.157.091h5.552c.174 0 .322.11.446.327l1.454 2.57c.19.337.24.478.024.837-.26.43-.513.864-.76 1.3l-.367.658c-.106.196-.223.28-.04.512l2.652 4.637c.172.301.111.494-.043.77-.437.785-.882 1.564-1.335 2.34-.159.272-.352.375-.68.37-.777-.016-1.552-.01-2.327.016a.099.099 0 00-.081.05 575.097 575.097 0 01-2.705 4.74c-.169.293-.38.363-.725.364-.997.003-2.002.004-3.017.002a.537.537 0 01-.465-.271l-1.335-2.323a.09.09 0 00-.083-.049H4.982c-.285.03-.553-.001-.805-.092l-1.603-2.77a.543.543 0 01-.002-.54l1.207-2.12a.198.198 0 000-.197 550.951 550.951 0 01-1.875-3.272l-.79-1.395c-.16-.31-.173-.496.095-.965.465-.813.927-1.625 1.387-2.436.132-.234.304-.334.584-.335a338.3 338.3 0 012.589-.001.124.124 0 00.107-.063l2.806-4.895a.488.488 0 01.422-.246c.524-.001 1.053 0 1.583-.006L11.704 1c.341-.003.724.032.9.34zm-3.432.403a.06.06 0 00-.052.03L6.254 6.788a.157.157 0 01-.135.078H3.253c-.056 0-.07.025-.041.074l5.81 10.156c.025.042.013.062-.034.063l-2.795.015a.218.218 0 00-.2.116l-1.32 2.31c-.044.078-.021.118.068.118l5.716.008c.046 0 .08.02.104.061l1.403 2.454c.046.081.092.082.139 0l5.006-8.76.783-1.382a.055.055 0 01.096 0l1.424 2.53a.122.122 0 00.107.062l2.763-.02a.04.04 0 00.035-.02.041.041 0 000-.04l-2.9-5.086a.108.108 0 010-.113l.293-.507 1.12-1.977c.024-.041.012-.062-.035-.062H9.2c-.059 0-.073-.026-.043-.077l1.434-2.505a.107.107 0 000-.114L9.225 1.774a.06.06 0 00-.053-.031zm6.29 8.02c.046 0 .058.02.034.06l-.832 1.465-2.613 4.585a.056.056 0 01-.05.029.058.058 0 01-.05-.029L8.498 9.841c-.02-.034-.01-.052.028-.054l.216-.012 6.722-.012z" fill="url(#qwen-g)" fill-rule="nonzero"/><defs><linearGradient id="qwen-g" x1="0%" x2="100%" y1="0%" y2="0%"><stop offset="0%" stop-color="#6336E7" stop-opacity=".84"/><stop offset="100%" stop-color="#6F69F7" stop-opacity=".84"/></linearGradient></defs></svg>`;

const GEMMA_SVG = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="gemma-g" x1="24.419%" x2="75.194%" y1="75.581%" y2="25.194%"><stop offset="0%" stop-color="#446EFF"/><stop offset="36.661%" stop-color="#2E96FF"/><stop offset="83.221%" stop-color="#B1C5FF"/></linearGradient></defs><path d="M12.34 5.953a8.233 8.233 0 01-.247-1.125V3.72a8.25 8.25 0 015.562 2.232H12.34zm-.69 0c.113-.373.199-.755.257-1.145V3.72a8.25 8.25 0 00-5.562 2.232h5.304zm-5.433.187h5.373a7.98 7.98 0 01-.267.696 8.41 8.41 0 01-1.76 2.65L6.216 6.14zm-.264-.187H2.977v.187h2.915a8.436 8.436 0 00-2.357 5.767H0v.186h3.535a8.436 8.436 0 002.357 5.767H2.977v.186h2.976v2.977h.187v-2.915a8.436 8.436 0 005.767 2.357V24h.186v-3.535a8.436 8.436 0 005.767-2.357v2.915h.186v-2.977h2.977v-.186h-2.915a8.436 8.436 0 002.357-5.767H24v-.186h-3.535a8.436 8.436 0 00-2.357-5.767h2.915v-.187h-2.977V2.977h-.186v2.915a8.436 8.436 0 00-5.767-2.357V0h-.186v3.535A8.436 8.436 0 006.14 5.892V2.977h-.187v2.976zm6.14 14.326a8.25 8.25 0 005.562-2.233H12.34c-.108.367-.19.743-.247 1.126v1.107zm-.186-1.087a8.015 8.015 0 00-.258-1.146H6.345a8.25 8.25 0 005.562 2.233v-1.087zm-8.186-7.285h1.107a8.23 8.23 0 001.125-.247V6.345a8.25 8.25 0 00-2.232 5.562zm1.087.186H3.72a8.25 8.25 0 002.232 5.562v-5.304a8.012 8.012 0 00-1.145-.258zm15.47-.186a8.25 8.25 0 00-2.232-5.562v5.315c.367.108.743.19 1.126.247h1.107zm-1.086.186c-.39.058-.772.144-1.146.258v5.304a8.25 8.25 0 002.233-5.562h-1.087zm-1.332 5.69V12.41a7.97 7.97 0 00-.696.267 8.409 8.409 0 00-2.65 1.76l3.346 3.346zm0-6.18v-5.45l-.012-.013h-5.451c.076.235.162.468.26.696a8.698 8.698 0 001.819 2.688 8.698 8.698 0 002.688 1.82c.228.097.46.183.696.259zM6.14 17.848V12.41c.235.078.468.167.696.267a8.403 8.403 0 012.688 1.799 8.404 8.404 0 011.799 2.688c.1.228.19.46.267.696H6.152l-.012-.012zm0-6.245V6.326l3.29 3.29a8.716 8.716 0 01-2.594 1.728 8.14 8.14 0 01-.696.259zm6.257 6.257h5.277l-3.29-3.29a8.716 8.716 0 00-1.728 2.594 8.135 8.135 0 00-.259.696zm-2.347-7.81a9.435 9.435 0 01-2.88 1.96 9.14 9.14 0 012.88 1.94 9.14 9.14 0 011.94 2.88 9.435 9.435 0 011.96-2.88 9.14 9.14 0 012.88-1.94 9.435 9.435 0 01-2.88-1.96 9.434 9.434 0 01-1.96-2.88 9.14 9.14 0 01-1.94 2.88z" fill="url(#gemma-g)" fill-rule="evenodd"/></svg>`;

const LIQUID_SVG = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12.028 8.546l-.008.005 3.03 5.25a3.94 3.94 0 01.643 2.162c0 .754-.212 1.46-.58 2.062l6.173-1.991L11.63 0 9.304 3.872l2.724 4.674zM6.837 24l4.85-4.053h-.013c-2.219 0-4.017-1.784-4.017-3.984 0-.794.235-1.534.64-2.156l2.865-4.976-2.381-4.087L2 16.034 6.83 24h.007zM13.737 19.382h-.001L8.222 24h8.182l4.148-6.769-6.815 2.151z" fill="#00C2FF"/></svg>`;

export interface ModelBrandBadge {
  letter: string;
  color: string;
  svg?: string;
}

export function getModelBrandBadge(baseModel: string): ModelBrandBadge {
  switch (baseModel) {
    case "0.8B":
    case "2B":
    case "4B":
      return { letter: "Q", color: "#6F69F7", svg: QWEN_SVG };
    case "E2B":
    case "embedding":
      return { letter: "G", color: "#4285F4", svg: GEMMA_SVG };
    case "350M":
    case "1.2B":
      return { letter: "L", color: "#00C2FF", svg: LIQUID_SVG };
    case "translation":
      return { letter: "T", color: "#10A37F" };
    default:
      return { letter: "M", color: "#8E8EA0" };
  }
}
