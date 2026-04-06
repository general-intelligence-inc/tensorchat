export interface SherpaVoiceTranscribeOptions {
  language?: string;
  sampleRate?: number;
}

export interface SherpaVoiceSynthesizeOptions {
  voice?: string;
  rate?: number;
  pitch?: number;
  volume?: number;
}

export interface SherpaVoiceTranscriptionResult {
  text: string;
}

export interface SherpaVoiceSynthesisResult {
  audio?: string;
  audioData?: string;
  audioEncoding?: 'pcm16' | 'float32';
  sampleRate?: number;
}

export declare function loadSTTModel(modelPath: string, modelType?: string): Promise<boolean>;
export declare function isSTTModelLoaded(): Promise<boolean>;
export declare function unloadSTTModel(): Promise<boolean>;
export declare function transcribeFile(
  filePath: string,
  options?: SherpaVoiceTranscribeOptions,
): Promise<SherpaVoiceTranscriptionResult>;

export declare function loadTTSModel(modelPath: string, modelType?: string): Promise<boolean>;
export declare function isTTSModelLoaded(): Promise<boolean>;
export declare function unloadTTSModel(): Promise<boolean>;
export declare function synthesize(
  text: string,
  options?: SherpaVoiceSynthesizeOptions,
): Promise<SherpaVoiceSynthesisResult>;

export declare const isConfigured: boolean;
export declare const isAvailable: boolean;

declare const _default: {
  loadSTTModel: typeof loadSTTModel;
  isSTTModelLoaded: typeof isSTTModelLoaded;
  unloadSTTModel: typeof unloadSTTModel;
  transcribeFile: typeof transcribeFile;
  loadTTSModel: typeof loadTTSModel;
  isTTSModelLoaded: typeof isTTSModelLoaded;
  unloadTTSModel: typeof unloadTTSModel;
  synthesize: typeof synthesize;
  isConfigured: typeof isConfigured;
  isAvailable: typeof isAvailable;
};

export default _default;