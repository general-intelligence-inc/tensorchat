package com.k2fsa.sherpa.onnx

class OfflineStream(var ptr: Long) {
  fun acceptWaveform(samples: FloatArray, sampleRate: Int) = acceptWaveform(ptr, samples, sampleRate)

  fun release() {
    if (ptr != 0L) {
      delete(ptr)
      ptr = 0L
    }
  }

  protected fun finalize() {
    release()
  }

  private external fun acceptWaveform(ptr: Long, samples: FloatArray, sampleRate: Int)
  private external fun delete(ptr: Long)

  companion object {
    init {
      System.loadLibrary("sherpa-onnx-jni")
    }
  }
}