package com.reactnativesherpavoice

import android.util.Base64
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.k2fsa.sherpa.onnx.FeatureConfig
import com.k2fsa.sherpa.onnx.HomophoneReplacerConfig
import com.k2fsa.sherpa.onnx.OfflineModelConfig
import com.k2fsa.sherpa.onnx.OfflineRecognizer
import com.k2fsa.sherpa.onnx.OfflineRecognizerConfig
import com.k2fsa.sherpa.onnx.OfflineTts
import com.k2fsa.sherpa.onnx.OfflineTtsConfig
import com.k2fsa.sherpa.onnx.OfflineTtsModelConfig
import com.k2fsa.sherpa.onnx.OfflineTtsVitsModelConfig
import com.k2fsa.sherpa.onnx.OfflineWhisperModelConfig
import com.k2fsa.sherpa.onnx.WaveReader
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.Executors

class SherpaVoiceModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
  private val executor = Executors.newSingleThreadExecutor()
  private val lock = Any()

  @Volatile
  private var sttRecognizer: OfflineRecognizer? = null

  @Volatile
  private var ttsEngine: OfflineTts? = null

  override fun getName(): String = NAME

  override fun getConstants(): MutableMap<String, Any> {
    return mutableMapOf("isConfigured" to true)
  }

  @ReactMethod
  fun loadSTTModel(modelPath: String, modelType: String?, promise: Promise) {
    executor.execute {
      try {
        requireModelType(modelType, "whisper")

        val recognizer = OfflineRecognizer(
          config = buildOfflineRecognizerConfig(normalizePath(modelPath)),
        )

        synchronized(lock) {
          sttRecognizer?.release()
          sttRecognizer = recognizer
        }

        promise.resolve(true)
      } catch (error: Throwable) {
        promise.reject(ERROR_STT_LOAD, error.message, error)
      }
    }
  }

  @ReactMethod
  fun isSTTModelLoaded(promise: Promise) {
    promise.resolve(sttRecognizer != null)
  }

  @ReactMethod
  fun unloadSTTModel(promise: Promise) {
    executor.execute {
      val unloaded = synchronized(lock) {
        val recognizer = sttRecognizer
        sttRecognizer = null
        recognizer?.release()
        recognizer != null
      }

      promise.resolve(unloaded)
    }
  }

  @ReactMethod
  fun transcribeFile(filePath: String, options: ReadableMap?, promise: Promise) {
    executor.execute {
      try {
        val recognizer = sttRecognizer ?: throw IllegalStateException("STT model is not loaded.")
        val wave = WaveReader.readWave(normalizePath(filePath))
        val stream = recognizer.createStream()

        try {
          stream.acceptWaveform(wave.samples, wave.sampleRate)
          recognizer.decode(stream)

          val result = recognizer.getResult(stream)
          val payload = Arguments.createMap().apply {
            putString("text", result.text)
          }

          promise.resolve(payload)
        } finally {
          stream.release()
        }
      } catch (error: Throwable) {
        promise.reject(ERROR_TRANSCRIBE, error.message, error)
      }
    }
  }

  @ReactMethod
  fun loadTTSModel(modelPath: String, modelType: String?, promise: Promise) {
    executor.execute {
      try {
        requireModelType(modelType, "piper")

        val tts = OfflineTts(
          config = buildOfflineTtsConfig(normalizePath(modelPath)),
        )

        synchronized(lock) {
          ttsEngine?.release()
          ttsEngine = tts
        }

        promise.resolve(true)
      } catch (error: Throwable) {
        promise.reject(ERROR_TTS_LOAD, error.message, error)
      }
    }
  }

  @ReactMethod
  fun isTTSModelLoaded(promise: Promise) {
    promise.resolve(ttsEngine != null)
  }

  @ReactMethod
  fun unloadTTSModel(promise: Promise) {
    executor.execute {
      val unloaded = synchronized(lock) {
        val tts = ttsEngine
        ttsEngine = null
        tts?.release()
        tts != null
      }

      promise.resolve(unloaded)
    }
  }

  @ReactMethod
  fun synthesize(text: String, options: ReadableMap?, promise: Promise) {
    executor.execute {
      try {
        val tts = ttsEngine ?: throw IllegalStateException("TTS model is not loaded.")
        val audio = tts.generate(
          text = text,
          sid = getSpeakerId(options),
          speed = getFloatOption(options, "rate", 1.0f).coerceIn(0.25f, 4.0f),
        )
        val audioBase64 = pcm16Base64(audio.samples, getFloatOption(options, "volume", 1.0f))
        if (audioBase64.isEmpty()) {
          throw IllegalStateException("Speech synthesis returned empty audio data.")
        }

        val payload = Arguments.createMap().apply {
          putString("audio", audioBase64)
          putString("audioEncoding", "pcm16")
          putInt("sampleRate", audio.sampleRate)
        }

        promise.resolve(payload)
      } catch (error: Throwable) {
        promise.reject(ERROR_SYNTHESIZE, error.message, error)
      }
    }
  }

  private fun normalizePath(path: String): String {
    return if (path.startsWith("file://")) path.removePrefix("file://") else path
  }

  private fun requireModelType(modelType: String?, expectedType: String) {
    if (modelType.isNullOrBlank()) {
      return
    }

    if (!modelType.equals(expectedType, ignoreCase = true)) {
      throw IllegalArgumentException("Unsupported sherpa model type '$modelType'. Expected '$expectedType'.")
    }
  }

  private fun buildOfflineRecognizerConfig(modelPath: String): OfflineRecognizerConfig {
    val modelDir = requireModelDirectory(modelPath)
    val encoderPath = requireFirstMatchingFile(modelDir, listOf("-encoder.int8.onnx", "-encoder.onnx"))
    val decoderPath = requireFirstMatchingFile(modelDir, listOf("-decoder.int8.onnx", "-decoder.onnx"))
    val tokensPath = requireFirstMatchingFile(modelDir, listOf("-tokens.txt", "tokens.txt"))

    return OfflineRecognizerConfig(
      featConfig = FeatureConfig(sampleRate = 16000, featureDim = 80, dither = 0.0f),
      modelConfig = OfflineModelConfig(
        whisper = OfflineWhisperModelConfig(
          encoder = encoderPath,
          decoder = decoderPath,
          language = "en",
          task = "transcribe",
          tailPaddings = 1000,
          enableTokenTimestamps = false,
          enableSegmentTimestamps = false,
        ),
        numThreads = recommendedThreadCount(),
        provider = "cpu",
        modelType = "whisper",
        tokens = tokensPath,
      ),
      hr = HomophoneReplacerConfig(),
      decodingMethod = "greedy_search",
      maxActivePaths = 4,
    )
  }

  private fun buildOfflineTtsConfig(modelPath: String): OfflineTtsConfig {
    val modelDir = requireModelDirectory(modelPath)
    val onnxPath = findFirstOnnxFile(modelDir)
      ?: throw IllegalArgumentException("Unable to locate a Piper .onnx file in ${modelDir.absolutePath}.")
    val tokensPath = requireFirstMatchingFile(modelDir, listOf("tokens.txt"))
    val dataDir = findFirstMatchingDirectory(modelDir, "espeak-ng-data")?.absolutePath
      ?: throw IllegalArgumentException("Unable to locate espeak-ng-data in ${modelDir.absolutePath}.")
    val lexiconPath = findFirstMatchingFile(modelDir, listOf("lexicon.txt")) ?: ""

    return OfflineTtsConfig(
      model = OfflineTtsModelConfig(
        vits = OfflineTtsVitsModelConfig(
          model = onnxPath,
          lexicon = lexiconPath,
          tokens = tokensPath,
          dataDir = dataDir,
          noiseScale = 0.667f,
          noiseScaleW = 0.8f,
          lengthScale = 1.0f,
        ),
        numThreads = recommendedThreadCount(),
        provider = "cpu",
      ),
      maxNumSentences = 1,
      silenceScale = 0.2f,
    )
  }

  private fun requireModelDirectory(modelPath: String): File {
    val directory = File(modelPath)
    if (!directory.isDirectory) {
      throw IllegalArgumentException("Model directory not found: $modelPath")
    }

    return directory
  }

  private fun requireFirstMatchingFile(directory: File, suffixes: List<String>): String {
    return findFirstMatchingFile(directory, suffixes)
      ?: throw IllegalArgumentException(
        "Unable to locate any of ${suffixes.joinToString(", ")} in ${directory.absolutePath}.",
      )
  }

  private fun findFirstMatchingFile(directory: File, suffixes: List<String>): String? {
    val files = directory.walkTopDown()
      .filter { candidate -> candidate.isFile && !candidate.name.startsWith(".") }
      .toList()

    for (suffix in suffixes) {
      val match = files.firstOrNull { candidate -> candidate.name.endsWith(suffix) }
      if (match != null) {
        return match.absolutePath
      }
    }

    return null
  }

  private fun findFirstOnnxFile(directory: File): String? {
    return directory.walkTopDown()
      .firstOrNull { candidate ->
        candidate.isFile &&
          !candidate.name.startsWith(".") &&
          candidate.extension.equals("onnx", ignoreCase = true)
      }
      ?.absolutePath
  }

  private fun findFirstMatchingDirectory(directory: File, name: String): File? {
    return directory.walkTopDown()
      .firstOrNull { candidate ->
        candidate.isDirectory && candidate.name == name
      }
  }

  private fun recommendedThreadCount(): Int {
    return Runtime.getRuntime().availableProcessors().coerceIn(1, 4)
  }

  private fun getFloatOption(options: ReadableMap?, key: String, defaultValue: Float): Float {
    if (options == null || !options.hasKey(key) || options.isNull(key)) {
      return defaultValue
    }

    return options.getDouble(key).toFloat()
  }

  private fun getSpeakerId(options: ReadableMap?): Int {
    if (options == null || !options.hasKey("voice") || options.isNull("voice")) {
      return 0
    }

    return options.getString("voice")?.trim()?.toIntOrNull() ?: 0
  }

  private fun pcm16Base64(samples: FloatArray, volume: Float): String {
    val clampedVolume = volume.coerceIn(0.0f, 2.0f)
    val byteBuffer = ByteBuffer.allocate(samples.size * 2).order(ByteOrder.LITTLE_ENDIAN)

    for (sample in samples) {
      val scaled = (sample * clampedVolume).coerceIn(-1.0f, 1.0f)
      val pcm = when {
        scaled >= 1.0f -> Short.MAX_VALUE.toInt()
        scaled <= -1.0f -> Short.MIN_VALUE.toInt()
        else -> (scaled * 32767.0f).toInt()
      }
      byteBuffer.putShort(pcm.toShort())
    }

    return Base64.encodeToString(byteBuffer.array(), Base64.NO_WRAP)
  }

  companion object {
    private const val NAME = "SherpaVoice"
    private const val ERROR_STT_LOAD = "E_SHERPA_STT_LOAD"
    private const val ERROR_TRANSCRIBE = "E_SHERPA_TRANSCRIBE"
    private const val ERROR_TTS_LOAD = "E_SHERPA_TTS_LOAD"
    private const val ERROR_SYNTHESIZE = "E_SHERPA_SYNTHESIZE"
  }
}