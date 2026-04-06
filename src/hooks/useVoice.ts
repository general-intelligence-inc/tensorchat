import { useCallback, useEffect, useRef, useState } from 'react';
import { InteractionManager, Platform } from 'react-native';
import RNFS from 'react-native-fs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ensureKokoroPhonemizerReady,
  isKokoroPhonemizerSupportedRuntime,
  phonemizeForKokoro,
  splitTextIntoKokoroUtterances,
} from '../utils/kokoroPhonemizer';
import { encodeKokoroPhonemeChunks, parseKokoroTokenizer } from '../utils/kokoroTokenizer';
import { optionalRequire } from '../utils/optionalRequire';

type OrtModuleLike = typeof import('onnxruntime-react-native');
type OrtInferenceSession = import('onnxruntime-common').InferenceSession;
type OrtSessionOptions = import('onnxruntime-common').InferenceSession.SessionOptions;

type VoiceModel = 'stt' | 'tts';
type TTSBackend = 'piper' | 'kokoro';
type VoiceStage = 'initializing' | 'downloading' | 'loading' | 'transcribing' | 'synthesizing' | 'playing';

interface VoiceProgressInfo {
  model: VoiceModel;
  stage: VoiceStage;
  progress: number;
  message: string;
  ttsBackend?: TTSBackend;
}

interface VoiceModelStatus {
  sttDownloaded: boolean;
  ttsDownloaded: boolean;
  sttLoaded: boolean;
  ttsLoaded: boolean;
  piperDownloaded: boolean;
  piperLoaded: boolean;
  kokoroDownloaded: boolean;
  kokoroLoaded: boolean;
  activeTTSBackend: TTSBackend | null;
}

interface VoiceModelConfig {
  id: string;
  legacyIds?: string[];
  name: string;
  url: string;
  memoryRequirement: number;
}

interface SherpaVoiceLike {
  isAvailable: boolean;
  isConfigured: boolean;
  loadSTTModel: (modelPath: string, modelType?: string) => Promise<boolean>;
  isSTTModelLoaded: () => Promise<boolean>;
  unloadSTTModel: () => Promise<boolean>;
  transcribeFile: (filePath: string, options?: { language?: string; sampleRate?: number }) => Promise<{ text: string }>;
  loadTTSModel: (modelPath: string, modelType?: string) => Promise<boolean>;
  isTTSModelLoaded: () => Promise<boolean>;
  unloadTTSModel: () => Promise<boolean>;
  synthesize: (
    text: string,
    options?: { voice?: string; rate?: number; pitch?: number; volume?: number },
  ) => Promise<{ audio?: string; audioData?: string; audioEncoding?: 'pcm16' | 'float32'; sampleRate?: number }>;
}

interface UseVoiceReturn {
  isAvailable: boolean;
  isKokoroAvailable: boolean;
  progress: VoiceProgressInfo | null;
  error: string | null;
  getVoiceModelStatus: () => Promise<VoiceModelStatus>;
  downloadVoiceModelsOnly: () => Promise<void>;
  deleteVoiceModels: () => Promise<void>;
  downloadKokoroVoiceModelOnly: () => Promise<void>;
  deleteKokoroVoiceModel: () => Promise<void>;
  ensureSTTModelReady: () => Promise<void>;
  ensureTTSModelReady: () => Promise<void>;
  ensureVoiceModelsReady: () => Promise<void>;
  startRecording: () => Promise<void>;
  stopRecordingAndTranscribe: (language?: string) => Promise<string>;
  pauseAndTranscribe: (language?: string) => Promise<string>;
  pauseRecording: () => Promise<void>;
  cancelRecording: () => Promise<void>;
  speakText: (text: string) => Promise<void>;
  stopSpeaking: () => Promise<void>;
  clearError: () => void;
}

const STT_MODEL: VoiceModelConfig = {
  id: 'sherpa-onnx-whisper-tiny.en',
  legacyIds: ['whisper-tiny-en'],
  name: 'Whisper Tiny English',
  url: 'https://github.com/general-intelligence-inc/tensorchat-models/releases/download/1.0.0/sherpa-onnx-whisper-tiny.en.zip',
  memoryRequirement: 75_000_000,
};

const PIPER_TTS_MODEL: VoiceModelConfig = {
  id: 'vits-piper-en_US-lessac-medium',
  legacyIds: ['piper-en-lessac'],
  name: 'Piper English (Lessac)',
  url: 'https://github.com/general-intelligence-inc/tensorchat-models/releases/download/1.0.0/vits-piper-en_US-lessac-medium.zip',
  memoryRequirement: 65_000_000,
};

const KOKORO_TTS_MODEL: VoiceModelConfig = {
  id: 'kokoro-82m-v1.0-af-heart-q8f16',
  name: 'Kokoro 82M (af_heart)',
  url: 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/onnx/model_q8f16.onnx?download=true',
  memoryRequirement: 87_000_000,
};

const KOKORO_TTS = {
  modelFilename: 'model_q8f16.onnx',
  tokenizerFilename: 'tokenizer.json',
  voiceFilename: 'af_heart.bin',
  tokenizerUrl: 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/tokenizer.json?download=true',
  voiceUrl: 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/voices/af_heart.bin?download=true',
  modelExpectedBytes: 86_000_000,
  modelMinimumBytes: 70_000_000,
  tokenizerExpectedBytes: 3_500,
  tokenizerMinimumBytes: 1_000,
  voiceExpectedBytes: 522_240,
  voiceMinimumBytes: 500_000,
  maxTokens: 510,
  sampleRate: 24_000,
  styleWidth: 256,
  chunkGapSamples: 1_920,
  firstChunkMaxTokens: Platform.OS === 'ios' ? 128 : 192,
  initialPlaybackLeadSeconds: 0.02,
  firstUtteranceTargetChars: Platform.OS === 'ios' ? 120 : 160,
  targetUtteranceChars: Platform.OS === 'ios' ? 240 : 300,
  minUtteranceChars: 48,
  maxUtteranceChars: Platform.OS === 'ios' ? 300 : 380,
  maxSentencesPerUtterance: 3,
} as const;

interface DownloadableFileAsset {
  name: string;
  fileName: string;
  url: string;
  expectedBytes: number;
  minimumBytes: number;
}

const KOKORO_FILE_ASSETS: readonly DownloadableFileAsset[] = [
  {
    name: 'Kokoro model',
    fileName: KOKORO_TTS.modelFilename,
    url: KOKORO_TTS_MODEL.url,
    expectedBytes: KOKORO_TTS.modelExpectedBytes,
    minimumBytes: KOKORO_TTS.modelMinimumBytes,
  },
  {
    name: 'Kokoro tokenizer',
    fileName: KOKORO_TTS.tokenizerFilename,
    url: KOKORO_TTS.tokenizerUrl,
    expectedBytes: KOKORO_TTS.tokenizerExpectedBytes,
    minimumBytes: KOKORO_TTS.tokenizerMinimumBytes,
  },
  {
    name: 'Kokoro voice',
    fileName: KOKORO_TTS.voiceFilename,
    url: KOKORO_TTS.voiceUrl,
    expectedBytes: KOKORO_TTS.voiceExpectedBytes,
    minimumBytes: KOKORO_TTS.voiceMinimumBytes,
  },
] as const;

// ── react-native-audio-api types (kept local to avoid top-level import on web) ──

interface AudioRecorderLike {
  enableFileOutput(options: {
    format?: number;
    channelCount?: number;
    directory?: number;
    preset?: {
      sampleRate: number;
      bitRate: number;
      bitDepth: number;
      iosQuality: number;
      flacCompressionLevel: number;
    };
  }): { status: 'success'; path: string } | { status: 'error'; message: string };
  start(): { status: 'success'; path: string } | { status: 'error'; message: string };
  stop(): { status: 'success'; path: string; size: number; duration: number } | { status: 'error'; message: string };
}

interface AudioBufferLike {
  duration: number;
  length: number;
  numberOfChannels: number;
  sampleRate: number;
}

interface AudioBufferSourceNodeLike {
  buffer: AudioBufferLike | null;
  onended: (() => void) | null;
  connect(destination: AudioDestinationNodeLike): void;
  start(when?: number): void;
  stop(): void;
}

interface AudioDestinationNodeLike {}

interface AudioContextLike {
  readonly currentTime: number;
  readonly destination: AudioDestinationNodeLike;
  readonly sampleRate: number;
  close(): Promise<void>;
  resume(): Promise<boolean>;
  suspend(): Promise<boolean>;
  decodeAudioData(input: string): Promise<AudioBufferLike>;
  decodePCMInBase64(
    base64String: string,
    inputSampleRate: number,
    inputChannelCount: number,
    isInterleaved?: boolean,
  ): Promise<AudioBufferLike>;
  createBufferSource(): AudioBufferSourceNodeLike;
}

interface AudioApiModuleLike {
  AudioRecorder: new () => AudioRecorderLike;
  AudioContext: new (options?: { sampleRate?: number }) => AudioContextLike;
  AudioManager: {
    setAudioSessionOptions(options: { iosCategory?: string; iosMode?: string }): void;
    requestRecordingPermissions(): Promise<'Undetermined' | 'Denied' | 'Granted'>;
  };
  FileFormat: { Wav: number; M4A: number };
  FileDirectory: { Cache: number; Document: number };
  BitDepth: { Bit16: number; Bit24: number; Bit32: number };
  IOSAudioQuality: { Min: number; Low: number; Medium: number; High: number; Max: number };
  FlacCompressionLevel: { L0: number };
}

let audioApiModule: AudioApiModuleLike | null = null;

audioApiModule = optionalRequire<AudioApiModuleLike>(() => require('react-native-audio-api'));

if (!audioApiModule) {
  console.warn('[Voice] react-native-audio-api not available — recording will not work');
}

let ortModule: OrtModuleLike | null = null;
let sherpaVoiceModule: SherpaVoiceLike | null = null;

const VOICE_DOWNLOADED_KEYS = {
  stt: '@voice/stt_downloaded',
  tts: '@voice/tts_downloaded',
  kokoro: '@voice/kokoro_downloaded',
} as const;

const TTS_CANCELLED_ERROR_MESSAGE = 'TTS playback cancelled.';

/** Always derive the model directory path fresh from the current app container. */
function voiceModelPath(model: VoiceModelConfig): string {
  return `${RNFS.DocumentDirectoryPath}/${model.id}`;
}

const loadedSherpaVoiceModule = optionalRequire<SherpaVoiceLike>(() => require('react-native-sherpa-voice'));

if (loadedSherpaVoiceModule) {
  sherpaVoiceModule = loadedSherpaVoiceModule;
} else {
  // The bridge is optional during the migration.
}

ortModule = optionalRequire<OrtModuleLike>(() => require('onnxruntime-react-native'));

if (!ortModule) {
  console.warn('[Voice] onnxruntime-react-native not available — Kokoro TTS will not work');
}

// react-native-zip-archive is used to bypass the SDK's native ZIP extractor,
// which fails to decompress our GitHub release ZIPs.
let zipArchiveModule: { unzip: (source: string, target: string) => Promise<string> } | null = null;
zipArchiveModule = optionalRequire<{ unzip: (source: string, target: string) => Promise<string> }>(() => require('react-native-zip-archive'));

if (!zipArchiveModule) {
  console.warn('[Voice] react-native-zip-archive not available — voice downloads will not work');
}

function normalizeFilePath(uri: string): string {
  return uri.startsWith('file://') ? uri.slice('file://'.length) : uri;
}

function kokoroAssetPath(fileName: string): string {
  return `${voiceModelPath(KOKORO_TTS_MODEL)}/${fileName}`;
}

function parentDirectory(filePath: string): string {
  const lastSlash = filePath.lastIndexOf('/');
  return lastSlash >= 0 ? filePath.slice(0, lastSlash) : filePath;
}

async function ensureDirectory(dirPath: string): Promise<void> {
  const exists = await RNFS.exists(dirPath);
  if (!exists) {
    await RNFS.mkdir(dirPath);
  }
}

async function isLikelyCompleteFile(filePath: string, minimumBytes: number): Promise<boolean> {
  try {
    const exists = await RNFS.exists(filePath);
    if (!exists) return false;

    const stat = await RNFS.stat(filePath);
    return Number(stat.size) >= minimumBytes;
  } catch {
    return false;
  }
}

async function areKokoroAssetsReady(): Promise<boolean> {
  const checks = await Promise.all(
    KOKORO_FILE_ASSETS.map((asset) => isLikelyCompleteFile(kokoroAssetPath(asset.fileName), asset.minimumBytes)),
  );
  return checks.every(Boolean);
}

async function downloadFileAsset(
  asset: DownloadableFileAsset,
  destinationPath: string,
  onProgress: (progress: number) => void,
): Promise<string> {
  await ensureDirectory(parentDirectory(destinationPath));

  let totalBytes = asset.expectedBytes;

  const { jobId, promise } = RNFS.downloadFile({
    fromUrl: asset.url,
    toFile: destinationPath,
    background: Platform.OS === 'ios',
    discretionary: false,
    progressInterval: 50,
    begin: ({ contentLength }: { jobId: number; statusCode: number; contentLength: number; headers: Record<string, string> }) => {
      if (contentLength > 0) {
        totalBytes = contentLength;
      }
    },
    progress: ({ bytesWritten }: { jobId: number; contentLength: number; bytesWritten: number }) => {
      if (totalBytes > 0) {
        onProgress(Math.min(1, bytesWritten / totalBytes));
      }
    },
  });

  let result;
  try {
    result = await promise;
  } finally {
    if (Platform.OS === 'ios') {
      try {
        RNFS.completeHandlerIOS(jobId);
      } catch {}
    }
  }

  if (result.statusCode < 200 || result.statusCode >= 300) {
    await RNFS.unlink(destinationPath).catch(() => {});
    throw new Error(`${asset.name} download failed with HTTP ${result.statusCode}.`);
  }

  const stat = await RNFS.stat(destinationPath);
  if (Number(stat.size) < asset.minimumBytes) {
    await RNFS.unlink(destinationPath).catch(() => {});
    throw new Error(`${asset.name} appears incomplete after download.`);
  }

  return destinationPath;
}

function base64ToUint8Array(base64: string): Uint8Array {
  const sanitized = base64.replace(/\s+/g, '');

  if (sanitized.length % 4 !== 0) {
    throw new Error('Invalid base64 payload.');
  }

  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const outputLength = sanitized.endsWith('==')
    ? (sanitized.length / 4) * 3 - 2
    : sanitized.endsWith('=')
      ? (sanitized.length / 4) * 3 - 1
      : (sanitized.length / 4) * 3;
  const bytes = new Uint8Array(outputLength);

  let outputIndex = 0;

  for (let index = 0; index < sanitized.length; index += 4) {
    const enc1 = alphabet.indexOf(sanitized[index]);
    const enc2 = alphabet.indexOf(sanitized[index + 1]);
    const enc3 = sanitized[index + 2] === '=' ? 64 : alphabet.indexOf(sanitized[index + 2]);
    const enc4 = sanitized[index + 3] === '=' ? 64 : alphabet.indexOf(sanitized[index + 3]);

    const triple = (enc1 << 18) | (enc2 << 12) | ((enc3 & 63) << 6) | (enc4 & 63);

    bytes[outputIndex++] = (triple >> 16) & 0xFF;
    if (enc3 !== 64 && outputIndex < bytes.length) {
      bytes[outputIndex++] = (triple >> 8) & 0xFF;
    }
    if (enc4 !== 64 && outputIndex < bytes.length) {
      bytes[outputIndex++] = triple & 0xFF;
    }
  }

  return bytes;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';

  for (let index = 0; index < bytes.length; index += 3) {
    const byte1 = bytes[index];
    const byte2 = index + 1 < bytes.length ? bytes[index + 1] : 0;
    const byte3 = index + 2 < bytes.length ? bytes[index + 2] : 0;
    const triple = (byte1 << 16) | (byte2 << 8) | byte3;

    output += alphabet[(triple >> 18) & 63];
    output += alphabet[(triple >> 12) & 63];
    output += index + 1 < bytes.length ? alphabet[(triple >> 6) & 63] : '=';
    output += index + 2 < bytes.length ? alphabet[triple & 63] : '=';
  }

  return output;
}

function float32ArrayToPCM16Base64(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.length * Int16Array.BYTES_PER_ELEMENT);
  const view = new DataView(bytes.buffer);

  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
    const pcm16 = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    view.setInt16(index * Int16Array.BYTES_PER_ELEMENT, Math.round(pcm16), true);
  }

  return uint8ArrayToBase64(bytes);
}

function float32Base64ToPCM16Base64(base64: string): string {
  return float32ArrayToPCM16Base64(base64ToFloat32Array(base64));
}

function base64ToFloat32Array(base64: string): Float32Array {
  const bytes = base64ToUint8Array(base64);

  if (bytes.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
    throw new Error('Kokoro voice asset has an invalid byte length.');
  }

  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / Float32Array.BYTES_PER_ELEMENT);
}

function float16BitsToFloat32(bits: number): number {
  const sign = (bits & 0x8000) === 0 ? 1 : -1;
  const exponent = (bits >> 10) & 0x1f;
  const mantissa = bits & 0x03ff;

  if (exponent === 0) {
    if (mantissa === 0) {
      return sign * 0;
    }

    return sign * Math.pow(2, -14) * (mantissa / 1024);
  }

  if (exponent === 0x1f) {
    return mantissa === 0 ? sign * Infinity : Number.NaN;
  }

  return sign * Math.pow(2, exponent - 15) * (1 + mantissa / 1024);
}

function float16ArrayToFloat32Array(values: Uint16Array): Float32Array {
  const converted = new Float32Array(values.length);

  for (let index = 0; index < values.length; index += 1) {
    converted[index] = float16BitsToFloat32(values[index] ?? 0);
  }

  return converted;
}

function getKokoroStyleVector(voiceData: Float32Array, tokenCount: number): Float32Array {
  const availableRows = Math.floor(voiceData.length / KOKORO_TTS.styleWidth);

  if (availableRows === 0) {
    throw new Error('Kokoro voice asset is empty.');
  }

  const rowIndex = Math.min(Math.max(tokenCount, 0), availableRows - 1);
  const start = rowIndex * KOKORO_TTS.styleWidth;
  const end = start + KOKORO_TTS.styleWidth;
  return voiceData.slice(start, end);
}

function getAudioTensorData(output: unknown): Float32Array {
  if (!output || typeof output !== 'object' || !('data' in output)) {
    throw new Error('Kokoro inference did not return audio data.');
  }

  const tensorOutput = output as { data: unknown; type?: unknown };
  const data = tensorOutput.data;
  const tensorType = typeof tensorOutput.type === 'string' ? tensorOutput.type : null;

  if (data instanceof Float32Array) {
    return data;
  }

  if (tensorType === 'float16' && data instanceof Uint16Array) {
    return float16ArrayToFloat32Array(data);
  }

  if (tensorType === 'float16' && ArrayBuffer.isView(data)) {
    const typedArray = data as ArrayBufferView & { readonly length: number; [index: number]: number };
    return Float32Array.from(
      Array.from({ length: typedArray.length }, (_, index) => Number(typedArray[index] ?? 0)),
    );
  }

  if (ArrayBuffer.isView(data)) {
    const typedArray = data as ArrayBufferView;

    if (typedArray.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
      throw new Error(`Kokoro inference returned ${tensorType ?? 'non-float32'} audio data with an unsupported byte length.`);
    }

    return new Float32Array(typedArray.buffer.slice(typedArray.byteOffset, typedArray.byteOffset + typedArray.byteLength));
  }

  if (Array.isArray(data)) {
    return Float32Array.from(data);
  }

  throw new Error('Kokoro inference returned an unsupported audio tensor type.');
}

function toProgressMessage(model: VoiceModel, progress: number): string {
  const label = model === 'stt' ? 'speech recognition model' : 'speech synthesis model';
  return `Downloading ${label}... ${Math.round(progress * 100)}%`;
}

function getVoiceErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  return 'Voice operation failed.';
}

function isTTSCancelledError(error: unknown): boolean {
  return getVoiceErrorMessage(error) === TTS_CANCELLED_ERROR_MESSAGE;
}

/**
 * Returns true if the model has been fully extracted to `dirPath`
 * (directory exists and contains at least one entry).
 */
async function isModelExtracted(dirPath: string): Promise<boolean> {
  try {
    if (!await RNFS.exists(dirPath)) return false;
    const contents = await RNFS.readdir(dirPath);
    return contents.length > 0;
  } catch {
    return false;
  }
}

/**
 * Downloads the model ZIP from `model.url` using RNFS and extracts it
 * with react-native-zip-archive.
 * The ZIP is expected to contain a top-level directory whose name matches
 * `model.id` (e.g. `sherpa-onnx-whisper-tiny.en/`).
 * Returns the path to the extracted model directory.
 */
async function downloadAndExtractModel(
  model: VoiceModelConfig,
  onProgress: (stage: 'downloading' | 'extracting', progress: number) => void,
): Promise<string> {
  if (!zipArchiveModule) {
    throw new Error('ZIP extraction is unavailable. Please rebuild the app with react-native-zip-archive.');
  }

  const zipPath = `${RNFS.DocumentDirectoryPath}/${model.id}.zip`;
  const extractedPath = `${RNFS.DocumentDirectoryPath}/${model.id}`;

  // Capture content-length reliably from the begin callback (fires once after
  // redirect resolution with the real Content-Length from the CDN response).
  let totalBytes = 0;

  const { jobId, promise } = RNFS.downloadFile({
    fromUrl: model.url,
    toFile: zipPath,
    background: Platform.OS === 'ios',
    discretionary: false,
    progressInterval: 50, // ms — match expo-file-system cadence for smooth UI
    begin: ({ contentLength }: { jobId: number; statusCode: number; contentLength: number; headers: Record<string, string> }) => {
      totalBytes = contentLength;
    },
    progress: ({ bytesWritten }: { jobId: number; contentLength: number; bytesWritten: number }) => {
      if (totalBytes > 0) {
        onProgress('downloading', bytesWritten / totalBytes);
      }
    },
  });

  let result;
  try {
    result = await promise;
  } finally {
    if (Platform.OS === 'ios') {
      try {
        RNFS.completeHandlerIOS(jobId);
      } catch {}
    }
  }

  if (result.statusCode < 200 || result.statusCode >= 300) {
    await RNFS.unlink(zipPath).catch(() => {});
    throw new Error(`Model download failed with HTTP ${result.statusCode}`);
  }

  // Signal the extracting phase before unzip (can take 10–30 s for large models).
  onProgress('extracting', 0);

  // Extract ZIP contents (creates model.id/ directory inside DocumentDirectoryPath)
  await zipArchiveModule.unzip(zipPath, RNFS.DocumentDirectoryPath);

  // Clean up the ZIP file to free space
  await RNFS.unlink(zipPath).catch(() => {});

  return extractedPath;
}

function isSherpaBridgeAvailable(): boolean {
  return Platform.OS !== 'web' && !!sherpaVoiceModule?.isAvailable;
}

function requireSherpaVoiceModule(): SherpaVoiceLike {
  if (!isSherpaBridgeAvailable() || !sherpaVoiceModule) {
    throw new Error('Sherpa voice bridge is unavailable in this build.');
  }

  return sherpaVoiceModule;
}

function requireKokoroRuntime(): OrtModuleLike {
  if (!ortModule) {
    throw new Error('Kokoro ONNX runtime is unavailable in this build. Rebuild the native app after installing onnxruntime-react-native.');
  }

  return ortModule;
}

function getKokoroSessionOptions(): OrtSessionOptions {
  const options: OrtSessionOptions = {
    enableCpuMemArena: true,
    enableMemPattern: true,
    graphOptimizationLevel: 'all',
  };

  if (Platform.OS === 'ios') {
    options.executionProviders = ['cpu'];
  } else if (Platform.OS === 'android') {
    options.executionProviders = ['xnnpack', 'cpu'];
  }

  return options;
}

function isKokoroSupportedInCurrentRuntime(): boolean {
  return (Platform.OS === 'web' || Platform.OS === 'ios' || Platform.OS === 'android')
    && isKokoroPhonemizerSupportedRuntime();
}

async function shouldPreferKokoroTTS(): Promise<boolean> {
  if (!isKokoroSupportedInCurrentRuntime() || !ortModule || !await areKokoroAssetsReady()) {
    return false;
  }

  try {
    await ensureKokoroPhonemizerReady();
    return true;
  } catch (error) {
    console.warn(`[Voice] Kokoro phonemizer unavailable, falling back to Piper: ${getVoiceErrorMessage(error)}`);
    return false;
  }
}

export function useVoice(): UseVoiceReturn {
  const [progress, setProgress] = useState<VoiceProgressInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sttReadyPromiseRef = useRef<Promise<void> | null>(null);
  const ttsReadyPromiseRef = useRef<Promise<void> | null>(null);
  const activeTTSBackendRef = useRef<TTSBackend | null>(null);
  const kokoroSessionRef = useRef<OrtInferenceSession | null>(null);
  const kokoroTokenizerRef = useRef<Record<string, number> | null>(null);
  const kokoroVoiceDataRef = useRef<Float32Array | null>(null);
  const kokoroWarmPromiseRef = useRef<Promise<void> | null>(null);
  const kokoroWarmReadyRef = useRef(false);
  const ttsOperationIdRef = useRef(0);

  const isTTSOperationActive = useCallback((ttsOperationId?: number) => {
    return ttsOperationId === undefined || ttsOperationIdRef.current === ttsOperationId;
  }, []);

  const setProgressIfTTSOperationActive = useCallback((nextProgress: VoiceProgressInfo | null, ttsOperationId?: number) => {
    if (!isTTSOperationActive(ttsOperationId)) {
      return;
    }

    setProgress(nextProgress);
  }, [isTTSOperationActive]);

  const releaseKokoroSession = useCallback(async () => {
    if (kokoroSessionRef.current) {
      await kokoroSessionRef.current.release().catch(() => {});
      kokoroSessionRef.current = null;
    }

    kokoroTokenizerRef.current = null;
    kokoroVoiceDataRef.current = null;
    kokoroWarmReadyRef.current = false;
    kokoroWarmPromiseRef.current = null;

    if (activeTTSBackendRef.current === 'kokoro') {
      activeTTSBackendRef.current = null;
    }
  }, []);

  const warmKokoroRuntime = useCallback(async () => {
    if (kokoroWarmReadyRef.current) {
      return;
    }

    if (kokoroWarmPromiseRef.current) {
      await kokoroWarmPromiseRef.current;
      return;
    }

    kokoroWarmPromiseRef.current = (async () => {
      const session = kokoroSessionRef.current;
      const tokenizer = kokoroTokenizerRef.current;
      const voiceData = kokoroVoiceDataRef.current;

      if (!session || !tokenizer || !voiceData) {
        return;
      }

      const phonemized = await phonemizeForKokoro('Hello.');
      if (phonemized.unsupportedCharacters.length > 0) {
        return;
      }

      const encoded = encodeKokoroPhonemeChunks(phonemized.phonemes, tokenizer, KOKORO_TTS.maxTokens);
      const firstChunk = encoded.chunks[0];
      if (!firstChunk) {
        return;
      }

      const ort = requireKokoroRuntime();
      const paddedTokens = [0, ...firstChunk.tokenIds, 0];

      await session.run({
        input_ids: new ort.Tensor('int64', paddedTokens, [1, paddedTokens.length]),
        style: new ort.Tensor('float32', getKokoroStyleVector(voiceData, firstChunk.tokenIds.length), [1, KOKORO_TTS.styleWidth]),
        speed: new ort.Tensor('float32', new Float32Array([1.0]), [1]),
      });

      if (audioApiModule?.AudioContext) {
        const warmAudioContext = new audioApiModule.AudioContext({ sampleRate: KOKORO_TTS.sampleRate });
        await warmAudioContext.resume().catch(() => false);
        await warmAudioContext.close().catch(() => {});
      }

      kokoroWarmReadyRef.current = true;
    })()
      .catch((error) => {
        console.warn(`[Voice] Kokoro warmup skipped: ${getVoiceErrorMessage(error)}`);
      })
      .finally(() => {
        kokoroWarmPromiseRef.current = null;
      });

    await kokoroWarmPromiseRef.current;
  }, []);

  const unloadPiperTTS = useCallback(async () => {
    if (isSherpaBridgeAvailable()) {
      try {
        await requireSherpaVoiceModule().unloadTTSModel().catch(() => false);
      } catch {
        // Ignore unload failures when the runtime is unavailable.
      }
    }

    if (activeTTSBackendRef.current === 'piper') {
      activeTTSBackendRef.current = null;
    }
  }, []);

  const ensureModelReady = useCallback(async (target: VoiceModel, ttsOperationId?: number, silent: boolean = false) => {
    const promiseRef = target === 'stt' ? sttReadyPromiseRef : ttsReadyPromiseRef;
    if (promiseRef.current) {
      await promiseRef.current;
      return;
    }

    promiseRef.current = (async () => {
      if (target === 'tts') {
        const reportTTSProgress = (nextProgress: VoiceProgressInfo | null) => {
          if (silent) {
            return;
          }

          setProgressIfTTSOperationActive(nextProgress, ttsOperationId);
        };

        const preferredBackend: TTSBackend = await shouldPreferKokoroTTS() ? 'kokoro' : 'piper';

        if (preferredBackend === 'kokoro') {
          await unloadPiperTTS();

          if (kokoroSessionRef.current && kokoroTokenizerRef.current && kokoroVoiceDataRef.current) {
            activeTTSBackendRef.current = 'kokoro';
            reportTTSProgress(null);
            return;
          }

          await ensureDirectory(voiceModelPath(KOKORO_TTS_MODEL));

          const ort = requireKokoroRuntime();
          reportTTSProgress({
            model: 'tts',
            ttsBackend: 'kokoro',
            stage: 'loading',
            progress: 1,
            message: `Loading ${KOKORO_TTS_MODEL.name}...`,
          });

          let session: OrtInferenceSession | null = null;
          try {
            session = await ort.InferenceSession.create(
              kokoroAssetPath(KOKORO_TTS.modelFilename),
              getKokoroSessionOptions(),
            );

            const tokenizerJson = await RNFS.readFile(kokoroAssetPath(KOKORO_TTS.tokenizerFilename), 'utf8');
            const voiceBase64 = await RNFS.readFile(kokoroAssetPath(KOKORO_TTS.voiceFilename), 'base64');
            const voiceData = base64ToFloat32Array(voiceBase64);

            if (voiceData.length % KOKORO_TTS.styleWidth !== 0) {
              throw new Error('Kokoro voice asset does not align to 256-wide style rows.');
            }

            kokoroSessionRef.current = session;
            kokoroTokenizerRef.current = parseKokoroTokenizer(tokenizerJson);
            kokoroVoiceDataRef.current = voiceData;
            kokoroWarmReadyRef.current = false;
            activeTTSBackendRef.current = 'kokoro';
            reportTTSProgress(null);
            return;
          } catch (err) {
            if (session) {
              await session.release().catch(() => {});
            }
            kokoroSessionRef.current = null;
            kokoroTokenizerRef.current = null;
            kokoroVoiceDataRef.current = null;
            if (activeTTSBackendRef.current === 'kokoro') {
              activeTTSBackendRef.current = null;
            }
            throw err;
          }
        }

        await releaseKokoroSession();

        if (isSherpaBridgeAvailable()) {
          const sherpaVoice = requireSherpaVoiceModule();
          const isLoaded = await sherpaVoice.isTTSModelLoaded().catch(() => false);
          if (isLoaded && activeTTSBackendRef.current === 'piper') {
            reportTTSProgress(null);
            return;
          }

          const modelPath = voiceModelPath(PIPER_TTS_MODEL);
          const markedDownloaded = await AsyncStorage.getItem(VOICE_DOWNLOADED_KEYS.tts).catch(() => null);
          const alreadyExtracted = markedDownloaded === '1' && await isModelExtracted(modelPath);

          if (!alreadyExtracted) {
            reportTTSProgress({
              model: 'tts',
              ttsBackend: 'piper',
              stage: 'downloading',
              progress: 0,
              message: toProgressMessage('tts', 0),
            });

            await downloadAndExtractModel(PIPER_TTS_MODEL, (stage, p) => {
              reportTTSProgress({
                model: 'tts',
                ttsBackend: 'piper',
                stage: 'downloading',
                progress: stage === 'extracting' ? 1 : p,
                message: stage === 'extracting'
                  ? `Extracting ${PIPER_TTS_MODEL.name}...`
                  : toProgressMessage('tts', p),
              });
            });

            await AsyncStorage.setItem(VOICE_DOWNLOADED_KEYS.tts, '1').catch(() => {});
          }

          reportTTSProgress({
            model: 'tts',
            ttsBackend: 'piper',
            stage: 'loading',
            progress: 1,
            message: `Loading ${PIPER_TTS_MODEL.name}...`,
          });

          const loaded = await sherpaVoice.loadTTSModel(modelPath, 'piper');
          if (!loaded) {
            throw new Error(`Unable to load ${PIPER_TTS_MODEL.name}.`);
          }

          activeTTSBackendRef.current = 'piper';
          reportTTSProgress(null);
          return;
        }

        throw new Error('Sherpa voice bridge is unavailable in this build.');
      }

      if (isSherpaBridgeAvailable()) {
        const sherpaVoice = requireSherpaVoiceModule();
        const isLoaded = await sherpaVoice.isSTTModelLoaded().catch(() => false);
        if (isLoaded) {
          return;
        }

        const model = STT_MODEL;
        const modelPath = voiceModelPath(model);
        const markedDownloaded = await AsyncStorage.getItem(VOICE_DOWNLOADED_KEYS[target]).catch(() => null);
        const alreadyExtracted = markedDownloaded === '1' && await isModelExtracted(modelPath);

        if (!alreadyExtracted) {
          setProgress({
            model: target,
            stage: 'downloading',
            progress: 0,
            message: toProgressMessage(target, 0),
          });

          await downloadAndExtractModel(model, (stage, p) => {
            setProgress({
              model: target,
              stage: 'downloading',
              progress: stage === 'extracting' ? 1 : p,
              message: stage === 'extracting'
                ? `Extracting ${model.name}...`
                : toProgressMessage(target, p),
            });
          });

          await AsyncStorage.setItem(VOICE_DOWNLOADED_KEYS[target], '1').catch(() => {});
        }

        setProgress({
          model: target,
          stage: 'loading',
          progress: 1,
          message: `Loading ${model.name}...`,
        });

        const loaded = await sherpaVoice.loadSTTModel(modelPath, 'whisper');
        if (!loaded) {
          throw new Error(`Unable to load ${model.name}.`);
        }

        setProgress(null);
        return;
      }

      throw new Error('Sherpa voice bridge is unavailable in this build.');
    })();

    try {
      await promiseRef.current;
    } catch (err) {
      const message = getVoiceErrorMessage(err);
      if (!silent) {
        setError(message);
        setProgress(null);
      }
      throw err;
    } finally {
      promiseRef.current = null;
    }
  }, [releaseKokoroSession, setProgressIfTTSOperationActive, unloadPiperTTS]);

  useEffect(() => {
    let cancelled = false;

    const task = InteractionManager.runAfterInteractions(() => {
      void (async () => {
        if (cancelled) {
          return;
        }

        try {
          if (!await shouldPreferKokoroTTS()) {
            return;
          }

          await ensureModelReady('tts', undefined, true);
          if (cancelled) {
            return;
          }

          await warmKokoroRuntime();
        } catch {
          // Keep background prewarm silent; foreground playback will surface real errors if needed.
        }
      })();
    });

    return () => {
      cancelled = true;
      task.cancel?.();
    };
  }, [ensureModelReady, warmKokoroRuntime]);

  const ensureSTTModelReady = useCallback(async () => {
    await ensureModelReady('stt');
  }, [ensureModelReady]);

  const ensureTTSModelReady = useCallback(async () => {
    await ensureModelReady('tts');
  }, [ensureModelReady]);

  const ensureVoiceModelsReady = useCallback(async () => {
    await ensureSTTModelReady();
    await ensureTTSModelReady();
  }, [ensureSTTModelReady, ensureTTSModelReady]);

  const ensureModelDownloadedOnly = useCallback(async (target: VoiceModel) => {
    requireSherpaVoiceModule();

    if (target === 'tts') {
      const expectedPath = voiceModelPath(PIPER_TTS_MODEL);
      const markedDownloaded = await AsyncStorage.getItem(VOICE_DOWNLOADED_KEYS.tts).catch(() => null);
      if (markedDownloaded === '1' && await isModelExtracted(expectedPath)) {
        setProgress(null);
        return;
      }

      setProgress({ model: 'tts', ttsBackend: 'piper', stage: 'downloading', progress: 0, message: toProgressMessage('tts', 0) });

      await downloadAndExtractModel(PIPER_TTS_MODEL, (stage, p) => {
        setProgress({
          model: 'tts',
          ttsBackend: 'piper',
          stage: 'downloading',
          progress: stage === 'extracting' ? 1 : p,
          message: stage === 'extracting'
            ? `Extracting ${PIPER_TTS_MODEL.name}...`
            : toProgressMessage('tts', p),
        });
      });

      await AsyncStorage.setItem(VOICE_DOWNLOADED_KEYS.tts, '1').catch(() => {});
      setProgress(null);
      return;
    }

    const expectedPath = voiceModelPath(STT_MODEL);
    const markedDownloaded = await AsyncStorage.getItem(VOICE_DOWNLOADED_KEYS.stt).catch(() => null);
    if (markedDownloaded === '1' && await isModelExtracted(expectedPath)) {
      setProgress(null);
      return;
    }

    setProgress({ model: 'stt', stage: 'downloading', progress: 0, message: toProgressMessage('stt', 0) });

    await downloadAndExtractModel(STT_MODEL, (stage, p) => {
      setProgress({
        model: 'stt',
        stage: 'downloading',
        progress: stage === 'extracting' ? 1 : p,
        message: stage === 'extracting'
          ? `Extracting ${STT_MODEL.name}...`
          : toProgressMessage('stt', p),
      });
    });

    await AsyncStorage.setItem(VOICE_DOWNLOADED_KEYS.stt, '1').catch(() => {});
    setProgress(null);
  }, []);

  const downloadKokoroVoiceModelOnly = useCallback(async () => {
    if (!isKokoroSupportedInCurrentRuntime()) {
      throw new Error('Kokoro playback is unavailable in this build. Reinstall dependencies and rebuild the native app to include the Phonemis bridge.');
    }

    if (!ortModule) {
      throw new Error('Kokoro is unavailable in this build. Rebuild the native app with onnxruntime-react-native first.');
    }

    await ensureKokoroPhonemizerReady();
    await ensureDirectory(voiceModelPath(KOKORO_TTS_MODEL));

    const totalExpectedBytes = KOKORO_FILE_ASSETS.reduce((sum, asset) => sum + asset.expectedBytes, 0);
    let completedBytes = 0;

    for (const asset of KOKORO_FILE_ASSETS) {
      const assetPath = kokoroAssetPath(asset.fileName);
      const alreadyPresent = await isLikelyCompleteFile(assetPath, asset.minimumBytes);

      if (alreadyPresent) {
        completedBytes += asset.expectedBytes;
        continue;
      }

      setProgress({
        model: 'tts',
        ttsBackend: 'kokoro',
        stage: 'downloading',
        progress: Math.min(1, completedBytes / totalExpectedBytes),
        message: toProgressMessage('tts', Math.min(1, completedBytes / totalExpectedBytes)),
      });

      await downloadFileAsset(asset, assetPath, (assetProgress) => {
        const progress = Math.min(1, (completedBytes + assetProgress * asset.expectedBytes) / totalExpectedBytes);
        setProgress({
          model: 'tts',
          ttsBackend: 'kokoro',
          stage: 'downloading',
          progress,
          message: toProgressMessage('tts', progress),
        });
      });

      completedBytes += asset.expectedBytes;
    }

    await AsyncStorage.setItem(VOICE_DOWNLOADED_KEYS.kokoro, '1').catch(() => {});
    setProgress(null);
  }, []);

  const downloadVoiceModelsOnly = useCallback(async () => {
    await ensureModelDownloadedOnly('stt');
    await ensureModelDownloadedOnly('tts');
  }, [ensureModelDownloadedOnly]);

  const deleteVoiceModels = useCallback(async () => {
    if (activeTTSBackendRef.current === 'piper') {
      await unloadPiperTTS();
    }

    // Delete the manually extracted model directories.
    const paths = [voiceModelPath(STT_MODEL), voiceModelPath(PIPER_TTS_MODEL)];
    await Promise.all([
      ...paths.map((p) => RNFS.unlink(p).catch(() => {})),
      AsyncStorage.removeItem(VOICE_DOWNLOADED_KEYS.stt).catch(() => {}),
      AsyncStorage.removeItem(VOICE_DOWNLOADED_KEYS.tts).catch(() => {}),
    ]);
  }, [unloadPiperTTS]);

  const deleteKokoroVoiceModel = useCallback(async () => {
    await releaseKokoroSession();
    await Promise.all([
      RNFS.unlink(voiceModelPath(KOKORO_TTS_MODEL)).catch(() => {}),
      AsyncStorage.removeItem(VOICE_DOWNLOADED_KEYS.kokoro).catch(() => {}),
    ]);
  }, [releaseKokoroSession]);

  const getVoiceModelStatus = useCallback(async () => {
    const sherpaVoice = isSherpaBridgeAvailable() ? requireSherpaVoiceModule() : null;

    const [sttDownloaded, piperDownloaded, sttLoaded, piperLoaded, kokoroDownloaded] = await Promise.all([
      isModelExtracted(voiceModelPath(STT_MODEL)),
      isModelExtracted(voiceModelPath(PIPER_TTS_MODEL)),
      sherpaVoice ? sherpaVoice.isSTTModelLoaded().catch(() => false) : Promise.resolve(false),
      sherpaVoice ? sherpaVoice.isTTSModelLoaded().catch(() => false) : Promise.resolve(false),
      areKokoroAssetsReady(),
    ]);

    const kokoroUsable = isKokoroSupportedInCurrentRuntime() && kokoroDownloaded;
    const kokoroLoaded = isKokoroSupportedInCurrentRuntime() && kokoroSessionRef.current !== null;
    const activeTTSBackend = kokoroLoaded
      ? 'kokoro'
      : piperLoaded
        ? 'piper'
        : activeTTSBackendRef.current === 'kokoro' && !isKokoroSupportedInCurrentRuntime()
          ? null
          : activeTTSBackendRef.current;

    return {
      sttDownloaded,
      ttsDownloaded: piperDownloaded || kokoroUsable,
      sttLoaded,
      ttsLoaded: piperLoaded || kokoroLoaded,
      piperDownloaded,
      piperLoaded,
      kokoroDownloaded,
      kokoroLoaded,
      activeTTSBackend,
    };
  }, []);

  const activeRecorderRef = useRef<AudioRecorderLike | null>(null);
  const activeRecordingPathRef = useRef<string | null>(null);
  const pausedAudioPathRef = useRef<string | null>(null);
  const activeAudioContextRef = useRef<AudioContextLike | null>(null);
  const activeAudioSourcesRef = useRef<AudioBufferSourceNodeLike[]>([]);
  const activeAudioPlaybackOperationIdRef = useRef<number | null>(null);

  const stopActiveAudioPlayback = useCallback(async () => {
    activeAudioPlaybackOperationIdRef.current = null;

    const activeSources = activeAudioSourcesRef.current;
    activeAudioSourcesRef.current = [];

    for (const source of activeSources) {
      try {
        source.stop();
      } catch {}
    }

    const activeAudioContext = activeAudioContextRef.current;
    activeAudioContextRef.current = null;

    if (activeAudioContext) {
      await activeAudioContext.close().catch(() => {});
    }
  }, []);

  const transcribeAudioFile = useCallback(async (audioPath: string, language: string = 'en'): Promise<string> => {
    const normalizedPath = normalizeFilePath(audioPath);

    try {
      const result = await requireSherpaVoiceModule().transcribeFile(normalizedPath, {
        language,
        sampleRate: 16000,
      });

      return (result.text ?? '').trim();
    } finally {
      await RNFS.unlink(normalizedPath).catch(() => {});
    }
  }, []);

  const startRecording = useCallback(async () => {
    if (!audioApiModule) {
      throw new Error('react-native-audio-api not available — rebuild the app with the native module.');
    }

    // The iOS Simulator has no audio input hardware — recording always fails.
    if (Platform.OS === 'ios' && !Platform.isPad && typeof Platform.constants !== 'undefined') {
      // React Native exposes `isSimulator` on iOS via NativeModules but not
      // directly on Platform. The most reliable runtime check is whether
      // the device model string contains 'Simulator'.
      const model: string = (Platform.constants as Record<string, unknown>).Model as string ?? '';
      if (model.toLowerCase().includes('simulator')) {
        throw new Error('Microphone recording is not supported on the iOS Simulator. Please test on a real device.');
      }
    }
    const { AudioRecorder, AudioManager, AudioContext, FileFormat, FileDirectory, BitDepth, IOSAudioQuality, FlacCompressionLevel } = audioApiModule;

    setError(null);

    await ensureSTTModelReady();

    // Loading the STT runtime may deactivate the iOS audio session.
    // setAudioSessionOptions only configures the category — it does NOT
    // reactivate the session.  Creating a temporary AudioContext and calling
    // resume() is the only reliable way to force the session back to active
    // (this is exactly what happens when TTS runs first).
    AudioManager.setAudioSessionOptions({
      iosCategory: 'playAndRecord',
      iosMode: 'measurement',
    });

    const activationCtx = new AudioContext({ sampleRate: 16000 });
    await activationCtx.resume();

    const permission = await AudioManager.requestRecordingPermissions();
    if (permission === 'Denied') {
      await activationCtx.close().catch(() => {});
      const msg = 'Microphone permission was denied. Please enable it in Settings.';
      setError(msg);
      throw new Error(msg);
    }

    const recorder = new AudioRecorder();

    const speechPreset = {
      sampleRate: 16000,
      bitRate: 48000,
      bitDepth: BitDepth.Bit16,
      iosQuality: IOSAudioQuality.Low,
      flacCompressionLevel: FlacCompressionLevel.L0,
    };

    const fileResult = recorder.enableFileOutput({
      format: FileFormat.Wav,
      channelCount: 1,
      directory: FileDirectory.Cache,
      preset: speechPreset,
    });
    if (fileResult.status === 'error') {
      await activationCtx.close().catch(() => {});
      const msg = `Failed to configure recorder: ${fileResult.message}`;
      setError(msg);
      throw new Error(msg);
    }

    let startResult: ReturnType<AudioRecorderLike['start']>;
    try {
      startResult = recorder.start();
    } catch (err) {
      await activationCtx.close().catch(() => {});
      const msg = `Failed to start recording: ${getVoiceErrorMessage(err)}`;
      setError(msg);
      throw new Error(msg);
    }
    if (startResult.status === 'error') {
      await activationCtx.close().catch(() => {});
      const msg = `Failed to start recording: ${startResult.message}`;
      setError(msg);
      throw new Error(msg);
    }

    // Recorder is now holding the session — safe to release the activation context.
    await activationCtx.close().catch(() => {});

    activeRecorderRef.current = recorder;
    activeRecordingPathRef.current = startResult.path;
  }, [ensureSTTModelReady]);

  const stopRecordingAndTranscribe = useCallback(async (language: string = 'en'): Promise<string> => {
    const recorder = activeRecorderRef.current;

    setError(null);
    setProgress({
      model: 'stt',
      stage: 'transcribing',
      progress: 1,
      message: 'Transcribing speech...',
    });

    try {
      let audioPath: string | null;

      if (recorder) {
        const stopResult = recorder.stop();
        activeRecorderRef.current = null;
        audioPath = stopResult.status === 'success'
          ? stopResult.path
          : activeRecordingPathRef.current;
        activeRecordingPathRef.current = null;
      } else {
        // Transcribing from a paused recording
        audioPath = pausedAudioPathRef.current;
        pausedAudioPathRef.current = null;
      }

      if (!audioPath) throw new Error('Recording path not available.');

      return await transcribeAudioFile(audioPath, language);
    } finally {
      setProgress(null);
    }
  }, [transcribeAudioFile]);

  /**
   * Stops the active recorder, transcribes the captured audio, and returns
   * the transcript.  Unlike stopRecordingAndTranscribe this does NOT show
   * the global "transcribing" progress indicator — callers handle their own
   * UI state so recording can be resumed immediately after.
   */
  const pauseAndTranscribe = useCallback(async (language: string = 'en'): Promise<string> => {
    const recorder = activeRecorderRef.current;
    let audioPath: string | null = null;

    if (recorder) {
      const stopResult = recorder.stop();
      activeRecorderRef.current = null;
      audioPath = stopResult.status === 'success'
        ? stopResult.path
        : activeRecordingPathRef.current;
      activeRecordingPathRef.current = null;
    }

    if (!audioPath) return '';

    return transcribeAudioFile(audioPath, language);
  }, [transcribeAudioFile]);

  const pauseRecording = useCallback(async () => {
    const recorder = activeRecorderRef.current;
    if (!recorder) return;
    try {
      const result = recorder.stop();
      activeRecorderRef.current = null;
      const path = result.status === 'success' ? result.path : activeRecordingPathRef.current;
      activeRecordingPathRef.current = null;
      if (path) {
        pausedAudioPathRef.current = path;
      }
    } catch {
      activeRecorderRef.current = null;
      activeRecordingPathRef.current = null;
    }
  }, []);

  const cancelRecording = useCallback(async () => {
    // Clean up any paused audio file first
    const pausedPath = pausedAudioPathRef.current;
    pausedAudioPathRef.current = null;
    if (pausedPath) await RNFS.unlink(normalizeFilePath(pausedPath)).catch(() => {});

    const recorder = activeRecorderRef.current;
    if (!recorder) return;
    try {
      const result = recorder.stop();
      activeRecorderRef.current = null;
      const path = result.status === 'success' ? result.path : activeRecordingPathRef.current;
      activeRecordingPathRef.current = null;
      if (path) await RNFS.unlink(normalizeFilePath(path)).catch(() => {});
    } catch {
      activeRecorderRef.current = null;
      activeRecordingPathRef.current = null;
    }
  }, []);

  const speakText = useCallback(async (text: string) => {
    if (!text.trim()) return;
    if (!audioApiModule?.AudioContext) {
      throw new Error('AudioContext not available — rebuild the app with react-native-audio-api.');
    }

    setError(null);

    const ttsOperationId = ttsOperationIdRef.current + 1;
    ttsOperationIdRef.current = ttsOperationId;

    await stopActiveAudioPlayback();
    await ensureModelReady('tts', ttsOperationId);

    if (!isTTSOperationActive(ttsOperationId)) {
      return;
    }

    const activeBackend = activeTTSBackendRef.current ?? (kokoroSessionRef.current ? 'kokoro' : 'piper');

    setProgressIfTTSOperationActive({
      model: 'tts',
      ttsBackend: activeBackend,
      stage: 'synthesizing',
      progress: 0,
      message: 'Synthesizing speech...',
    }, ttsOperationId);

    let audioContext: AudioContextLike | null = null;
    let audioSource: AudioBufferSourceNodeLike | null = null;
    try {
      if (activeBackend === 'kokoro') {
        const ort = requireKokoroRuntime();
        const session = kokoroSessionRef.current;
        const tokenizer = kokoroTokenizerRef.current;
        const voiceData = kokoroVoiceDataRef.current;

        if (!session || !tokenizer || !voiceData) {
          throw new Error('Kokoro TTS is not loaded.');
        }

        const utteranceSegments = splitTextIntoKokoroUtterances(text, {
          firstUtteranceTargetChars: KOKORO_TTS.firstUtteranceTargetChars,
          targetUtteranceChars: KOKORO_TTS.targetUtteranceChars,
          minUtteranceChars: KOKORO_TTS.minUtteranceChars,
          maxUtteranceChars: KOKORO_TTS.maxUtteranceChars,
          maxSentencesPerUtterance: KOKORO_TTS.maxSentencesPerUtterance,
        });

        if (utteranceSegments.length === 0) {
          throw new Error('Kokoro could not split the text into playable utterances.');
        }

        audioContext = new audioApiModule.AudioContext({ sampleRate: KOKORO_TTS.sampleRate });
        await audioContext.resume();

        if (!isTTSOperationActive(ttsOperationId)) {
          return;
        }

        activeAudioContextRef.current = audioContext;
        activeAudioPlaybackOperationIdRef.current = ttsOperationId;

        let nextPlaybackTime = audioContext.currentTime + KOKORO_TTS.initialPlaybackLeadSeconds;
        let lastScheduledSource: AudioBufferSourceNodeLike | null = null;
        let lastScheduledEndTime = nextPlaybackTime;
        let playbackStarted = false;
        let synthesizedChunkCount = 0;

        for (let utteranceIndex = 0; utteranceIndex < utteranceSegments.length; utteranceIndex += 1) {
          if (!isTTSOperationActive(ttsOperationId)) {
            return;
          }

          const utteranceText = utteranceSegments[utteranceIndex];
          const phonemized = await phonemizeForKokoro(utteranceText);

          if (!isTTSOperationActive(ttsOperationId)) {
            return;
          }

          if (phonemized.unsupportedCharacters.length > 0) {
            throw new Error(`Kokoro phonemization produced unsupported characters: ${phonemized.unsupportedCharacters.join(', ')}`);
          }

          const encoded = encodeKokoroPhonemeChunks(phonemized.phonemes, tokenizer, KOKORO_TTS.maxTokens, {
            firstChunkMaxTokens: playbackStarted ? undefined : KOKORO_TTS.firstChunkMaxTokens,
          });

          if (encoded.unsupportedCharacters.length > 0) {
            throw new Error(`Kokoro tokenizer does not support: ${encoded.unsupportedCharacters.join(', ')}`);
          }

          if (encoded.chunks.length === 0) {
            continue;
          }

          for (let chunkIndex = 0; chunkIndex < encoded.chunks.length; chunkIndex += 1) {
            if (!isTTSOperationActive(ttsOperationId)) {
              return;
            }

            const chunk = encoded.chunks[chunkIndex];
            const paddedTokens = [0, ...chunk.tokenIds, 0];

            if (!playbackStarted) {
              setProgressIfTTSOperationActive({
                model: 'tts',
                ttsBackend: 'kokoro',
                stage: 'synthesizing',
                progress: utteranceSegments.length === 1 ? 0 : utteranceIndex / utteranceSegments.length,
                message: utteranceSegments.length === 1
                  ? 'Synthesizing speech...'
                  : `Synthesizing segment ${utteranceIndex + 1}/${utteranceSegments.length}...`,
              }, ttsOperationId);
            }

            const result = await session.run({
              input_ids: new ort.Tensor('int64', paddedTokens, [1, paddedTokens.length]),
              style: new ort.Tensor('float32', getKokoroStyleVector(voiceData, chunk.tokenIds.length), [1, KOKORO_TTS.styleWidth]),
              speed: new ort.Tensor('float32', new Float32Array([1.0]), [1]),
            });

            if (!isTTSOperationActive(ttsOperationId)) {
              return;
            }

            const firstOutput = Object.values(result)[0];
            const chunkAudioBase64 = float32ArrayToPCM16Base64(getAudioTensorData(firstOutput));
            const audioBuffer = await audioContext.decodePCMInBase64(chunkAudioBase64, KOKORO_TTS.sampleRate, 1, false);

            if (!isTTSOperationActive(ttsOperationId)) {
              return;
            }

            const chunkSource = audioContext.createBufferSource();
            chunkSource.buffer = audioBuffer;
            chunkSource.connect(audioContext.destination);
            activeAudioSourcesRef.current.push(chunkSource);

            const scheduledStartTime = Math.max(
              nextPlaybackTime,
              audioContext.currentTime + (playbackStarted ? 0.01 : KOKORO_TTS.initialPlaybackLeadSeconds),
            );
            const scheduledEndTime = scheduledStartTime + audioBuffer.duration;

            if (!isTTSOperationActive(ttsOperationId) || activeAudioPlaybackOperationIdRef.current !== ttsOperationId) {
              return;
            }

            chunkSource.start(scheduledStartTime);

            synthesizedChunkCount += 1;
            lastScheduledSource = chunkSource;
            lastScheduledEndTime = scheduledEndTime;
            nextPlaybackTime = scheduledEndTime + KOKORO_TTS.chunkGapSamples / KOKORO_TTS.sampleRate;

            if (!playbackStarted) {
              playbackStarted = true;
              setProgressIfTTSOperationActive({
                model: 'tts',
                ttsBackend: 'kokoro',
                stage: 'playing',
                progress: 1,
                message: 'Playing speech...',
              }, ttsOperationId);
            }
          }
        }

        if (!playbackStarted || !lastScheduledSource || synthesizedChunkCount === 0) {
          throw new Error('Kokoro synthesis did not produce playable audio.');
        }

        await new Promise<void>((resolve) => {
          let done = false;
          let timer: ReturnType<typeof setTimeout> | null = null;
          const finish = () => {
            if (done) return;
            done = true;
            if (timer) {
              clearTimeout(timer);
            }
            resolve();
          };

          const previousOnEnded = lastScheduledSource.onended;
          lastScheduledSource.onended = () => {
            previousOnEnded?.();
            finish();
          };

          const remainingMs = Math.max(0, lastScheduledEndTime - (audioContext?.currentTime ?? 0)) * 1000 + 500;
          timer = setTimeout(finish, remainingMs);
        });
      } else {
        const result = await requireSherpaVoiceModule().synthesize(text, {
          rate: 1.0,
          pitch: 1.0,
          volume: 1.0,
        });

        if (!isTTSOperationActive(ttsOperationId)) {
          return;
        }

        const audioBase64 = result.audio ?? result.audioData ?? '';
        const sampleRate = result.sampleRate ?? 22050;

        if (!audioBase64) {
          throw new Error('Speech synthesis returned empty audio data.');
        }

        const pcm16AudioBase64 = result.audioEncoding === 'pcm16'
          ? audioBase64
          : float32Base64ToPCM16Base64(audioBase64);

        if (!isTTSOperationActive(ttsOperationId)) {
          return;
        }

        audioContext = new audioApiModule.AudioContext({ sampleRate });
        await audioContext.resume();

        if (!isTTSOperationActive(ttsOperationId)) {
          return;
        }

        activeAudioContextRef.current = audioContext;
        activeAudioPlaybackOperationIdRef.current = ttsOperationId;

  const audioBuffer = await audioContext.decodePCMInBase64(pcm16AudioBase64, sampleRate, 1, false);

        if (!isTTSOperationActive(ttsOperationId)) {
          return;
        }

        audioSource = audioContext.createBufferSource();
        audioSource.buffer = audioBuffer;
        audioSource.connect(audioContext.destination);
        activeAudioSourcesRef.current = [audioSource];

        setProgressIfTTSOperationActive({
          model: 'tts',
          ttsBackend: activeBackend,
          stage: 'playing',
          progress: 1,
          message: 'Playing speech...',
        }, ttsOperationId);

        await new Promise<void>((resolve) => {
          let done = false;
          let timer: ReturnType<typeof setTimeout> | null = null;
          const finish = () => {
            if (done) return;
            done = true;
            if (timer) {
              clearTimeout(timer);
            }
            resolve();
          };
          audioSource!.onended = finish;
          const durationMs = Math.ceil((audioBuffer.duration ?? 0) * 1000) + 500;
          timer = setTimeout(finish, durationMs);

          if (!isTTSOperationActive(ttsOperationId) || activeAudioPlaybackOperationIdRef.current !== ttsOperationId) {
            finish();
            return;
          }

          audioSource!.start(0);
        });
      }
    } catch (error) {
      if (!isTTSOperationActive(ttsOperationId) || isTTSCancelledError(error)) {
        return;
      }

      throw error;
    } finally {
      if (activeAudioPlaybackOperationIdRef.current === ttsOperationId) {
        activeAudioPlaybackOperationIdRef.current = null;
        activeAudioSourcesRef.current = [];
      }

      if (activeAudioContextRef.current === audioContext) {
        await audioContext?.close().catch(() => {});
        activeAudioContextRef.current = null;
      } else if (audioContext) {
        await audioContext.close().catch(() => {});
      }
      setProgressIfTTSOperationActive(null, ttsOperationId);
    }
  }, [ensureModelReady, isTTSOperationActive, setProgressIfTTSOperationActive, stopActiveAudioPlayback]);

  const stopSpeaking = useCallback(async () => {
    ttsOperationIdRef.current += 1;
    await stopActiveAudioPlayback();
    setProgress(null);
  }, [stopActiveAudioPlayback]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    isAvailable: !!audioApiModule && isSherpaBridgeAvailable(),
    isKokoroAvailable: !!ortModule && !!audioApiModule && isKokoroSupportedInCurrentRuntime(),
    progress,
    error,
    getVoiceModelStatus,
    downloadVoiceModelsOnly,
    deleteVoiceModels,
    downloadKokoroVoiceModelOnly,
    deleteKokoroVoiceModel,
    ensureSTTModelReady,
    ensureTTSModelReady,
    ensureVoiceModelsReady,
    startRecording,
    stopRecordingAndTranscribe,
    pauseAndTranscribe,
    pauseRecording,
    cancelRecording,
    speakText,
    stopSpeaking,
    clearError,
  };
}
