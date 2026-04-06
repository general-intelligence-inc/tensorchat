#import "SherpaVoiceModule.h"

#import <Foundation/Foundation.h>

#include <cmath>
#include <cstdint>
#include <limits>
#include <mutex>
#include <stdexcept>
#include <string>
#include <vector>

#include "sherpa-onnx/c-api/c-api.h"

namespace {

NSString *NormalizePath(NSString *path) {
  if ([path hasPrefix:@"file://"]) {
    return [path substringFromIndex:7];
  }

  return path;
}

std::string ToUtf8String(NSString *value) {
  const char *chars = value.UTF8String;
  return chars == nullptr ? std::string() : std::string(chars);
}

void ThrowWithMessage(NSString *message) {
  throw std::runtime_error(message.UTF8String ?: "Unknown sherpa voice error.");
}

NSString *NSStringFromStdException(const std::exception &error) {
  return [NSString stringWithUTF8String:error.what()] ?: @"Unknown sherpa voice error.";
}

int32_t RecommendedThreadCount() {
  NSInteger activeProcessorCount = NSProcessInfo.processInfo.activeProcessorCount;
  return (int32_t)MAX(1, MIN((NSInteger)4, activeProcessorCount));
}

void RequireModelType(NSString *modelType, NSString *expectedType) {
  if (modelType.length == 0) {
    return;
  }

  if ([modelType caseInsensitiveCompare:expectedType] != NSOrderedSame) {
    ThrowWithMessage([NSString stringWithFormat:@"Unsupported sherpa model type '%@'. Expected '%@'.", modelType, expectedType]);
  }
}

NSString *RequireModelDirectory(NSString *modelPath) {
  BOOL isDirectory = NO;
  if (![[NSFileManager defaultManager] fileExistsAtPath:modelPath isDirectory:&isDirectory] || !isDirectory) {
    ThrowWithMessage([NSString stringWithFormat:@"Model directory not found: %@", modelPath]);
  }

  return modelPath;
}

NSArray<NSString *> *CollectFiles(NSString *rootPath) {
  NSMutableArray<NSString *> *results = [NSMutableArray array];
  NSDirectoryEnumerator *enumerator = [[NSFileManager defaultManager] enumeratorAtPath:rootPath];

  for (NSString *relativePath in enumerator) {
    NSString *fullPath = [rootPath stringByAppendingPathComponent:relativePath];
    NSString *lastPathComponent = relativePath.lastPathComponent;
    if ([lastPathComponent hasPrefix:@"."] || [lastPathComponent isEqualToString:@"__MACOSX"]) {
      continue;
    }

    BOOL isDirectory = NO;
    if ([[NSFileManager defaultManager] fileExistsAtPath:fullPath isDirectory:&isDirectory] && !isDirectory) {
      [results addObject:fullPath];
    }
  }

  return [results sortedArrayUsingSelector:@selector(compare:)];
}

NSString *FindFirstFileMatchingSuffixes(NSString *rootPath, NSArray<NSString *> *suffixes) {
  NSArray<NSString *> *files = CollectFiles(rootPath);

  for (NSString *suffix in suffixes) {
    for (NSString *candidate in files) {
      if ([candidate hasSuffix:suffix]) {
        return candidate;
      }
    }
  }

  return nil;
}

NSString *RequireFirstFileMatchingSuffixes(NSString *rootPath, NSArray<NSString *> *suffixes) {
  NSString *match = FindFirstFileMatchingSuffixes(rootPath, suffixes);
  if (match.length == 0) {
    ThrowWithMessage([NSString stringWithFormat:@"Unable to locate any of %@ in %@.", [suffixes componentsJoinedByString:@", "], rootPath]);
  }

  return match;
}

NSString *FindFirstOnnxFile(NSString *rootPath) {
  for (NSString *candidate in CollectFiles(rootPath)) {
    if ([[candidate.pathExtension lowercaseString] isEqualToString:@"onnx"]) {
      return candidate;
    }
  }

  return nil;
}

NSString *FindFirstDirectoryNamed(NSString *rootPath, NSString *name) {
  NSDirectoryEnumerator *enumerator = [[NSFileManager defaultManager] enumeratorAtPath:rootPath];

  for (NSString *relativePath in enumerator) {
    NSString *fullPath = [rootPath stringByAppendingPathComponent:relativePath];
    BOOL isDirectory = NO;
    if ([[NSFileManager defaultManager] fileExistsAtPath:fullPath isDirectory:&isDirectory] && isDirectory && [fullPath.lastPathComponent isEqualToString:name]) {
      return fullPath;
    }
  }

  return nil;
}

float GetFloatOption(NSDictionary *options, NSString *key, float defaultValue) {
  id value = options[key];
  if (![value isKindOfClass:[NSNumber class]]) {
    return defaultValue;
  }

  return [(NSNumber *)value floatValue];
}

int32_t GetSpeakerId(NSDictionary *options) {
  id value = options[@"voice"];
  if ([value isKindOfClass:[NSNumber class]]) {
    return [(NSNumber *)value intValue];
  }

  if ([value isKindOfClass:[NSString class]]) {
    return [(NSString *)value intValue];
  }

  return 0;
}

NSString *PCM16Base64FromSamples(const float *samples, int32_t sampleCount, float volume) {
  if (samples == nullptr || sampleCount <= 0) {
    return @"";
  }

  float clampedVolume = std::max(0.0f, std::min(2.0f, volume));
  NSMutableData *pcmData = [NSMutableData dataWithLength:(NSUInteger)sampleCount * sizeof(int16_t)];
  auto *pcmBuffer = static_cast<int16_t *>(pcmData.mutableBytes);

  for (int32_t index = 0; index < sampleCount; ++index) {
    float scaled = std::max(-1.0f, std::min(1.0f, samples[index] * clampedVolume));
    int16_t pcmSample = 0;

    if (scaled >= 1.0f) {
      pcmSample = std::numeric_limits<int16_t>::max();
    } else if (scaled <= -1.0f) {
      pcmSample = std::numeric_limits<int16_t>::min();
    } else {
      pcmSample = static_cast<int16_t>(std::lround(scaled * 32767.0f));
    }

    pcmBuffer[index] = pcmSample;
  }

  return [pcmData base64EncodedStringWithOptions:0];
}

} // namespace

@interface SherpaVoiceModule () {
 @private
  std::mutex _mutex;
  const SherpaOnnxOfflineRecognizer *_sttRecognizer;
  const SherpaOnnxOfflineTts *_tts;
}
@end

@implementation SherpaVoiceModule

RCT_EXPORT_MODULE(SherpaVoice)

- (instancetype)init
{
  self = [super init];
  if (self) {
    _sttRecognizer = nullptr;
    _tts = nullptr;
  }

  return self;
}

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (void)dealloc
{
  std::lock_guard<std::mutex> lock(_mutex);
  if (_sttRecognizer != nullptr) {
    SherpaOnnxDestroyOfflineRecognizer(_sttRecognizer);
    _sttRecognizer = nullptr;
  }

  if (_tts != nullptr) {
    SherpaOnnxDestroyOfflineTts(_tts);
    _tts = nullptr;
  }
}

- (NSDictionary *)constantsToExport
{
  return @{ @"isConfigured": @YES };
}

RCT_REMAP_METHOD(loadSTTModel,
                 loadSTTModel:(NSString *)modelPath
                 modelType:(NSString *)modelType
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    @autoreleasepool {
      try {
        RequireModelType(modelType ?: @"", @"whisper");
        NSString *normalizedModelPath = RequireModelDirectory(NormalizePath(modelPath ?: @""));
        NSString *encoderPath = RequireFirstFileMatchingSuffixes(normalizedModelPath, @[ @"-encoder.int8.onnx", @"-encoder.onnx" ]);
        NSString *decoderPath = RequireFirstFileMatchingSuffixes(normalizedModelPath, @[ @"-decoder.int8.onnx", @"-decoder.onnx" ]);
        NSString *tokensPath = RequireFirstFileMatchingSuffixes(normalizedModelPath, @[ @"-tokens.txt", @"tokens.txt" ]);

        std::string encoder = ToUtf8String(encoderPath);
        std::string decoder = ToUtf8String(decoderPath);
        std::string tokens = ToUtf8String(tokensPath);

        SherpaOnnxOfflineRecognizerConfig config = {};
        config.feat_config.sample_rate = 16000;
        config.feat_config.feature_dim = 80;
        config.model_config.whisper.encoder = encoder.c_str();
        config.model_config.whisper.decoder = decoder.c_str();
        config.model_config.whisper.language = "en";
        config.model_config.whisper.task = "transcribe";
        config.model_config.whisper.tail_paddings = 1000;
        config.model_config.whisper.enable_token_timestamps = 0;
        config.model_config.whisper.enable_segment_timestamps = 0;
        config.model_config.tokens = tokens.c_str();
        config.model_config.num_threads = RecommendedThreadCount();
        config.model_config.provider = "cpu";
        config.model_config.model_type = "whisper";
        config.decoding_method = "greedy_search";
        config.max_active_paths = 4;
        config.hotwords_score = 1.5f;

        const SherpaOnnxOfflineRecognizer *recognizer = SherpaOnnxCreateOfflineRecognizer(&config);
        if (recognizer == nullptr) {
          ThrowWithMessage(@"Unable to create the sherpa Whisper recognizer.");
        }

        {
          std::lock_guard<std::mutex> lock(self->_mutex);
          if (self->_sttRecognizer != nullptr) {
            SherpaOnnxDestroyOfflineRecognizer(self->_sttRecognizer);
          }
          self->_sttRecognizer = recognizer;
        }

        resolve(@YES);
      } catch (const std::exception &error) {
        reject(@"E_SHERPA_STT_LOAD", NSStringFromStdException(error), nil);
      }
    }
  });
}

RCT_REMAP_METHOD(isSTTModelLoaded,
                 isSTTModelLoadedWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  std::lock_guard<std::mutex> lock(_mutex);
  resolve(@(_sttRecognizer != nullptr));
}

RCT_REMAP_METHOD(unloadSTTModel,
                 unloadSTTModelWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    bool unloaded = false;
    {
      std::lock_guard<std::mutex> lock(self->_mutex);
      if (self->_sttRecognizer != nullptr) {
        SherpaOnnxDestroyOfflineRecognizer(self->_sttRecognizer);
        self->_sttRecognizer = nullptr;
        unloaded = true;
      }
    }

    resolve(@(unloaded));
  });
}

RCT_REMAP_METHOD(transcribeFile,
                 transcribeFile:(NSString *)filePath
                 options:(NSDictionary *)options
                 transcribeResolver:(RCTPromiseResolveBlock)resolve
                 transcribeRejecter:(RCTPromiseRejectBlock)reject)
{
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    @autoreleasepool {
      const SherpaOnnxOfflineRecognizer *recognizer = nullptr;
      const SherpaOnnxWave *wave = nullptr;
      const SherpaOnnxOfflineStream *stream = nullptr;
      const SherpaOnnxOfflineRecognizerResult *result = nullptr;

      try {
        {
          std::lock_guard<std::mutex> lock(self->_mutex);
          recognizer = self->_sttRecognizer;
        }

        if (recognizer == nullptr) {
          ThrowWithMessage(@"STT model is not loaded.");
        }

        std::string normalizedFilePath = ToUtf8String(NormalizePath(filePath ?: @""));
        wave = SherpaOnnxReadWave(normalizedFilePath.c_str());
        if (wave == nullptr) {
          ThrowWithMessage([NSString stringWithFormat:@"Unable to read WAV audio at %@.", filePath ?: @"<unknown>"]);
        }

        stream = SherpaOnnxCreateOfflineStream(recognizer);
        if (stream == nullptr) {
          ThrowWithMessage(@"Unable to create a sherpa offline stream.");
        }

        SherpaOnnxAcceptWaveformOffline(stream, wave->sample_rate, wave->samples, wave->num_samples);
        SherpaOnnxDecodeOfflineStream(recognizer, stream);

        result = SherpaOnnxGetOfflineStreamResult(stream);
        NSString *text = result != nullptr && result->text != nullptr
          ? [NSString stringWithUTF8String:result->text]
          : @"";

        if (result != nullptr) {
          SherpaOnnxDestroyOfflineRecognizerResult(result);
          result = nullptr;
        }
        if (stream != nullptr) {
          SherpaOnnxDestroyOfflineStream(stream);
          stream = nullptr;
        }
        if (wave != nullptr) {
          SherpaOnnxFreeWave(wave);
          wave = nullptr;
        }

        resolve(@{ @"text": text ?: @"" });
      } catch (const std::exception &error) {
        if (result != nullptr) {
          SherpaOnnxDestroyOfflineRecognizerResult(result);
        }
        if (stream != nullptr) {
          SherpaOnnxDestroyOfflineStream(stream);
        }
        if (wave != nullptr) {
          SherpaOnnxFreeWave(wave);
        }

  reject(@"E_SHERPA_TRANSCRIBE", NSStringFromStdException(error), nil);
      }
    }
  });
}

RCT_REMAP_METHOD(loadTTSModel,
                 loadTTSModel:(NSString *)modelPath
                 ttsModelType:(NSString *)modelType
                 ttsResolver:(RCTPromiseResolveBlock)resolve
                 ttsRejecter:(RCTPromiseRejectBlock)reject)
{
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    @autoreleasepool {
      try {
        RequireModelType(modelType ?: @"", @"piper");
        NSString *normalizedModelPath = RequireModelDirectory(NormalizePath(modelPath ?: @""));
        NSString *onnxPath = FindFirstOnnxFile(normalizedModelPath);
        if (onnxPath.length == 0) {
          ThrowWithMessage([NSString stringWithFormat:@"Unable to locate a Piper .onnx file in %@.", normalizedModelPath]);
        }
        NSString *tokensPath = RequireFirstFileMatchingSuffixes(normalizedModelPath, @[ @"tokens.txt" ]);
        NSString *dataDir = FindFirstDirectoryNamed(normalizedModelPath, @"espeak-ng-data");
        if (dataDir.length == 0) {
          ThrowWithMessage([NSString stringWithFormat:@"Unable to locate espeak-ng-data in %@.", normalizedModelPath]);
        }
        NSString *lexiconPath = FindFirstFileMatchingSuffixes(normalizedModelPath, @[ @"lexicon.txt" ]) ?: @"";

        std::string onnx = ToUtf8String(onnxPath);
        std::string tokens = ToUtf8String(tokensPath);
        std::string dataDirectory = ToUtf8String(dataDir);
        std::string lexicon = ToUtf8String(lexiconPath);

        SherpaOnnxOfflineTtsConfig config = {};
        config.model.vits.model = onnx.c_str();
        config.model.vits.tokens = tokens.c_str();
        config.model.vits.data_dir = dataDirectory.c_str();
        config.model.vits.lexicon = lexicon.empty() ? "" : lexicon.c_str();
        config.model.vits.noise_scale = 0.667f;
        config.model.vits.noise_scale_w = 0.8f;
        config.model.vits.length_scale = 1.0f;
        config.model.num_threads = RecommendedThreadCount();
        config.model.provider = "cpu";
        config.max_num_sentences = 1;
        config.silence_scale = 0.2f;

        const SherpaOnnxOfflineTts *tts = SherpaOnnxCreateOfflineTts(&config);
        if (tts == nullptr) {
          ThrowWithMessage(@"Unable to create the sherpa Piper TTS runtime.");
        }

        {
          std::lock_guard<std::mutex> lock(self->_mutex);
          if (self->_tts != nullptr) {
            SherpaOnnxDestroyOfflineTts(self->_tts);
          }
          self->_tts = tts;
        }

        resolve(@YES);
      } catch (const std::exception &error) {
        reject(@"E_SHERPA_TTS_LOAD", NSStringFromStdException(error), nil);
      }
    }
  });
}

RCT_REMAP_METHOD(isTTSModelLoaded,
                 isTTSModelLoadedWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  std::lock_guard<std::mutex> lock(_mutex);
  resolve(@(_tts != nullptr));
}

RCT_REMAP_METHOD(unloadTTSModel,
                 unloadTTSModelWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    bool unloaded = false;
    {
      std::lock_guard<std::mutex> lock(self->_mutex);
      if (self->_tts != nullptr) {
        SherpaOnnxDestroyOfflineTts(self->_tts);
        self->_tts = nullptr;
        unloaded = true;
      }
    }

    resolve(@(unloaded));
  });
}

RCT_REMAP_METHOD(synthesize,
                 synthesize:(NSString *)text
                 synthesizeOptions:(NSDictionary *)options
                 synthesizeResolver:(RCTPromiseResolveBlock)resolve
                 synthesizeRejecter:(RCTPromiseRejectBlock)reject)
{
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    @autoreleasepool {
      const SherpaOnnxOfflineTts *tts = nullptr;
      const SherpaOnnxGeneratedAudio *audio = nullptr;

      try {
        {
          std::lock_guard<std::mutex> lock(self->_mutex);
          tts = self->_tts;
        }

        if (tts == nullptr) {
          ThrowWithMessage(@"TTS model is not loaded.");
        }

        float rate = GetFloatOption(options ?: @{}, @"rate", 1.0f);
        float volume = GetFloatOption(options ?: @{}, @"volume", 1.0f);

        std::string utf8Text = ToUtf8String(text ?: @"");
        audio = SherpaOnnxOfflineTtsGenerate(
            tts,
            utf8Text.c_str(),
            GetSpeakerId(options ?: @{}),
            std::max(0.25f, std::min(4.0f, rate)));
        if (audio == nullptr || audio->samples == nullptr || audio->n <= 0) {
          ThrowWithMessage(@"Speech synthesis returned empty audio data.");
        }

        NSString *pcm16Base64 = PCM16Base64FromSamples(audio->samples, audio->n, volume);
        NSNumber *sampleRate = @(audio->sample_rate > 0 ? audio->sample_rate : SherpaOnnxOfflineTtsSampleRate(tts));

        SherpaOnnxDestroyOfflineTtsGeneratedAudio(audio);
        audio = nullptr;

        resolve(@{
          @"audio": pcm16Base64 ?: @"",
          @"audioEncoding": @"pcm16",
          @"sampleRate": sampleRate,
        });
      } catch (const std::exception &error) {
        if (audio != nullptr) {
          SherpaOnnxDestroyOfflineTtsGeneratedAudio(audio);
        }

        reject(@"E_SHERPA_SYNTHESIZE", NSStringFromStdException(error), nil);
      }
    }
  });
}

@end