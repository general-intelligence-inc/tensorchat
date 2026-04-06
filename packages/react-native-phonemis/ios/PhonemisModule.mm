#import "PhonemisModule.h"

#import <Foundation/Foundation.h>

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

std::string toUtf8(NSString* value) {
  const char* chars = value.UTF8String;
  return chars == nullptr ? std::string() : std::string(chars);
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

NSString* normalizeLocale(NSString* value) {
  NSString* locale = value.length > 0 ? value.lowercaseString : @"en_us";
  if ([locale isEqualToString:@"en-gb"] || [locale isEqualToString:@"en_gb"] || [locale isEqualToString:@"gb"] || [locale isEqualToString:@"en-uk"] || [locale isEqualToString:@"en_uk"]) {
    return @"en_gb";
  }

  return @"en_us";
}

NSString* findResourcePath(NSString* name, NSString* extension) {
  NSArray<NSBundle*>* bundles = [[NSArray arrayWithObject:NSBundle.mainBundle] arrayByAddingObjectsFromArray:[NSBundle allBundles]];
  for (NSBundle* bundle in bundles) {
    NSString* path = [bundle pathForResource:name ofType:extension];
    if (path.length > 0) {
      return path;
    }
  }

  return nil;
}

} // namespace

@implementation PhonemisModule

RCT_EXPORT_MODULE(Phonemis)

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

RCT_REMAP_METHOD(phonemize,
                 phonemize:(NSString*)text
                 locale:(NSString*)locale
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    @autoreleasepool {
      try {
        NSString* normalizedLocale = normalizeLocale(locale);
        NSString* hmmPath = findResourcePath(@"hmm", @"json");
        NSString* lexiconName = [normalizedLocale isEqualToString:@"en_gb"] ? @"gb_merged" : @"us_merged";
        NSString* lexiconPath = findResourcePath(lexiconName, @"json");

        if (hmmPath.length == 0 || lexiconPath.length == 0) {
          throw std::runtime_error("Unable to locate bundled Phonemis JSON assets.");
        }

        auto* pipeline = getPipeline(
          toUtf8(normalizedLocale),
          toUtf8(hmmPath),
          toUtf8(lexiconPath)
        );
        const std::u32string phonemes = pipeline->process(toUtf8(text ?: @""));
        const std::string output = phonemis::utilities::string_utils::u32string_to_utf8(phonemes);
        NSString* result = [NSString stringWithUTF8String:output.c_str()];
        resolve(result ?: @"");
      } catch (const std::exception& error) {
        reject(@"E_PHONEMIZE", [NSString stringWithUTF8String:error.what()], nil);
      }
    }
  });
}

RCT_EXPORT_METHOD(clearCaches)
{
  std::lock_guard<std::mutex> lock(gPipelinesMutex);
  gPipelines.clear();
}

@end