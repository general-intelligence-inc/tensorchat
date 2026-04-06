package com.k2fsa.sherpa.onnx

import android.content.res.AssetManager

data class OfflineTtsVitsModelConfig(
  var model: String = "",
  var lexicon: String = "",
  var tokens: String = "",
  var dataDir: String = "",
  var dictDir: String = "",
  var noiseScale: Float = 0.667f,
  var noiseScaleW: Float = 0.8f,
  var lengthScale: Float = 1.0f,
)

data class OfflineTtsMatchaModelConfig(
  var acousticModel: String = "",
  var vocoder: String = "",
  var lexicon: String = "",
  var tokens: String = "",
  var dataDir: String = "",
  var dictDir: String = "",
  var noiseScale: Float = 1.0f,
  var lengthScale: Float = 1.0f,
)

data class OfflineTtsKokoroModelConfig(
  var model: String = "",
  var voices: String = "",
  var tokens: String = "",
  var dataDir: String = "",
  var lexicon: String = "",
  var lang: String = "",
  var dictDir: String = "",
  var lengthScale: Float = 1.0f,
)

data class OfflineTtsKittenModelConfig(
  var model: String = "",
  var voices: String = "",
  var tokens: String = "",
  var dataDir: String = "",
  var lengthScale: Float = 1.0f,
)

data class OfflineTtsZipvoiceModelConfig(
  var tokens: String = "",
  var encoder: String = "",
  var decoder: String = "",
  var vocoder: String = "",
  var dataDir: String = "",
  var lexicon: String = "",
  var featScale: Float = 0.0f,
  var tShift: Float = 0.0f,
  var targetRms: Float = 0.0f,
  var guidanceScale: Float = 0.0f,
)

data class OfflineTtsPocketModelConfig(
  var lmFlow: String = "",
  var lmMain: String = "",
  var encoder: String = "",
  var decoder: String = "",
  var textConditioner: String = "",
  var vocabJson: String = "",
  var tokenScoresJson: String = "",
  var voiceEmbeddingCacheCapacity: Int = 50,
)

data class OfflineTtsModelConfig(
  var vits: OfflineTtsVitsModelConfig = OfflineTtsVitsModelConfig(),
  var matcha: OfflineTtsMatchaModelConfig = OfflineTtsMatchaModelConfig(),
  var kokoro: OfflineTtsKokoroModelConfig = OfflineTtsKokoroModelConfig(),
  var kitten: OfflineTtsKittenModelConfig = OfflineTtsKittenModelConfig(),
  var zipvoice: OfflineTtsZipvoiceModelConfig = OfflineTtsZipvoiceModelConfig(),
  var pocket: OfflineTtsPocketModelConfig = OfflineTtsPocketModelConfig(),
  var numThreads: Int = 1,
  var debug: Boolean = false,
  var provider: String = "cpu",
)

data class OfflineTtsConfig(
  var model: OfflineTtsModelConfig = OfflineTtsModelConfig(),
  var ruleFsts: String = "",
  var ruleFars: String = "",
  var maxNumSentences: Int = 1,
  var silenceScale: Float = 0.2f,
)

class GeneratedAudio(
  val samples: FloatArray,
  val sampleRate: Int,
) {
  fun save(filename: String) = saveImpl(filename, samples, sampleRate)

  private external fun saveImpl(filename: String, samples: FloatArray, sampleRate: Int): Boolean
}

data class GenerationConfig(
  var silenceScale: Float = 0.2f,
  var speed: Float = 1.0f,
  var sid: Int = 0,
  var referenceAudio: FloatArray? = null,
  var referenceSampleRate: Int = 0,
  var referenceText: String? = null,
  var numSteps: Int = 5,
  var extra: Map<String, String>? = null,
)

class OfflineTts(
  assetManager: AssetManager? = null,
  var config: OfflineTtsConfig,
) {
  private var ptr: Long

  init {
    ptr = if (assetManager != null) {
      newFromAsset(assetManager, config)
    } else {
      newFromFile(config)
    }
  }

  fun sampleRate() = getSampleRate(ptr)

  fun numSpeakers() = getNumSpeakers(ptr)

  fun generateWithConfig(text: String, config: GenerationConfig): GeneratedAudio {
    return generateWithConfigImpl(ptr, text, config, null)
  }

  fun free() {
    if (ptr != 0L) {
      delete(ptr)
      ptr = 0L
    }
  }

  fun release() = free()

  protected fun finalize() {
    free()
  }

  private external fun newFromAsset(assetManager: AssetManager, config: OfflineTtsConfig): Long

  private external fun newFromFile(config: OfflineTtsConfig): Long

  private external fun delete(ptr: Long)
  private external fun getSampleRate(ptr: Long): Int
  private external fun getNumSpeakers(ptr: Long): Int
  private external fun generateWithConfigImpl(
    ptr: Long,
    text: String,
    config: GenerationConfig,
    callback: ((samples: FloatArray) -> Int)?,
  ): GeneratedAudio

  companion object {
    init {
      System.loadLibrary("sherpa-onnx-jni")
    }
  }
}