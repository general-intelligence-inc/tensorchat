#include <jni.h>

#include <memory>
#include <mutex>
#include <stdexcept>
#include <string>
#include <unordered_map>

#include <phonemis/pipeline.h>
#include <phonemis/utilities/string_utils.h>

namespace {

std::mutex gPipelinesMutex;
std::unordered_map<std::string, std::unique_ptr<phonemis::Pipeline>> gPipelines;

std::string toUtf8(JNIEnv* env, jstring value) {
  if (value == nullptr) {
    return std::string();
  }

  const char* chars = env->GetStringUTFChars(value, nullptr);
  if (chars == nullptr) {
    throw std::runtime_error("Unable to read JNI string.");
  }

  std::string result(chars);
  env->ReleaseStringUTFChars(value, chars);
  return result;
}

phonemis::Lang parseLanguage(const std::string& locale) {
  return locale == "en_gb" ? phonemis::Lang::EN_GB : phonemis::Lang::EN_US;
}

phonemis::Pipeline* getPipeline(
  const std::string& locale,
  const std::string& hmmPath,
  const std::string& lexiconPath) {
  const std::string cacheKey = locale + "|" + lexiconPath;
  std::lock_guard<std::mutex> lock(gPipelinesMutex);

  auto existing = gPipelines.find(cacheKey);
  if (existing != gPipelines.end()) {
    return existing->second.get();
  }

  auto pipeline = std::make_unique<phonemis::Pipeline>(
    parseLanguage(locale),
    hmmPath,
    lexiconPath
  );
  auto* pipelinePtr = pipeline.get();
  gPipelines.emplace(cacheKey, std::move(pipeline));
  return pipelinePtr;
}

} // namespace

extern "C"
JNIEXPORT jstring JNICALL
Java_com_reactnativephonemis_PhonemisModule_nativePhonemize(
  JNIEnv* env,
  jobject /* this */,
  jstring text,
  jstring locale,
  jstring hmmPath,
  jstring lexiconPath) {
  try {
    const std::string input = toUtf8(env, text);
    const std::string normalizedLocale = toUtf8(env, locale);
    const std::string hmm = toUtf8(env, hmmPath);
    const std::string lexicon = toUtf8(env, lexiconPath);

    if (hmm.empty() || lexicon.empty()) {
      throw std::runtime_error("Phonemis asset paths are empty.");
    }

    auto* pipeline = getPipeline(normalizedLocale, hmm, lexicon);
    const std::u32string phonemes = pipeline->process(input);
    const std::string output = phonemis::utilities::string_utils::u32string_to_utf8(phonemes);
    return env->NewStringUTF(output.c_str());
  } catch (const std::exception& error) {
    jclass runtimeException = env->FindClass("java/lang/RuntimeException");
    if (runtimeException != nullptr) {
      env->ThrowNew(runtimeException, error.what());
    }
    return nullptr;
  }
}

extern "C"
JNIEXPORT void JNICALL
Java_com_reactnativephonemis_PhonemisModule_nativeClearCaches(
  JNIEnv* /* env */,
  jobject /* this */) {
  std::lock_guard<std::mutex> lock(gPipelinesMutex);
  gPipelines.clear();
}