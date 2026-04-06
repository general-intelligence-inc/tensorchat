package com.reactnativephonemis

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.util.concurrent.Executors

class PhonemisModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
  private val executor = Executors.newSingleThreadExecutor()

  override fun getName(): String = NAME

  @ReactMethod
  fun phonemize(text: String, locale: String?, promise: Promise) {
    val normalizedLocale = normalizeLocale(locale)

    executor.execute {
      try {
        val dataDir = File(reactContext.noBackupFilesDir, "phonemis")
        if (!dataDir.exists() && !dataDir.mkdirs()) {
          throw IllegalStateException("Unable to create Phonemis asset directory.")
        }

        val hmmPath = ensureAssetFile("hmm.json", dataDir).absolutePath
        val lexiconPath = ensureAssetFile(lexiconFileName(normalizedLocale), dataDir).absolutePath
        val phonemes = nativePhonemize(text, normalizedLocale, hmmPath, lexiconPath)
        promise.resolve(phonemes)
      } catch (error: Throwable) {
        promise.reject("E_PHONEMIZE", error.message, error)
      }
    }
  }

  @ReactMethod
  fun clearCaches() {
    nativeClearCaches()
  }

  private fun normalizeLocale(locale: String?): String {
    return when ((locale ?: "en_us").lowercase()) {
      "en-gb", "en_gb", "gb", "en-uk", "en_uk" -> "en_gb"
      else -> "en_us"
    }
  }

  private fun lexiconFileName(locale: String): String {
    return if (locale == "en_gb") "gb_merged.json" else "us_merged.json"
  }

  private fun ensureAssetFile(assetName: String, targetDirectory: File): File {
    val targetFile = File(targetDirectory, assetName)
    if (targetFile.exists() && targetFile.length() > 0L) {
      return targetFile
    }

    reactContext.assets.open("phonemis/$assetName").use { input ->
      targetFile.outputStream().use { output ->
        input.copyTo(output)
      }
    }

    return targetFile
  }

  private external fun nativePhonemize(
    text: String,
    locale: String,
    hmmPath: String,
    lexiconPath: String,
  ): String

  private external fun nativeClearCaches()

  companion object {
    private const val NAME = "Phonemis"

    init {
      System.loadLibrary("reactnativephonemis")
    }
  }
}