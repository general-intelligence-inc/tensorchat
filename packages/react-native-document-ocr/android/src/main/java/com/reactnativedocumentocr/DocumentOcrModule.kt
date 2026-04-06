package com.reactnativedocumentocr

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap

class DocumentOcrModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = NAME

  override fun getConstants(): MutableMap<String, Any> {
    return mutableMapOf("isConfigured" to false)
  }

  @ReactMethod
  fun recognizePdfText(filePath: String, options: ReadableMap?, promise: Promise) {
    promise.reject(
      ERROR_UNAVAILABLE,
      "PDF OCR fallback is not available on Android in this build.",
    )
  }

  companion object {
    private const val ERROR_UNAVAILABLE = "E_PDF_OCR_UNAVAILABLE"
    private const val NAME = "DocumentOcr"
  }
}