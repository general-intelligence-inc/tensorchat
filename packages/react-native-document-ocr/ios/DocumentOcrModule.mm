#import "DocumentOcrModule.h"

#import <Foundation/Foundation.h>
#import <PDFKit/PDFKit.h>
#import <UIKit/UIKit.h>
#import <Vision/Vision.h>

#include <algorithm>
#include <cmath>
#include <stdexcept>
#include <string>
#include <vector>

namespace {

NSString *NormalizePath(NSString *path) {
  NSString *normalizedPath = path ?: @"";

  if ([normalizedPath hasPrefix:@"file://"]) {
    normalizedPath = [normalizedPath substringFromIndex:7];
  }

  NSString *decodedPath = normalizedPath.stringByRemovingPercentEncoding;
  return decodedPath.length > 0 ? decodedPath : normalizedPath;
}

void ThrowWithMessage(NSString *message) {
  throw std::runtime_error(message.UTF8String ?: "Unknown document OCR error.");
}

NSString *NSStringFromStdException(const std::exception &error) {
  return [NSString stringWithUTF8String:error.what()] ?: @"Unknown document OCR error.";
}

NSInteger GetIntegerOption(NSDictionary *options, NSString *key, NSInteger defaultValue) {
  id value = options[key];
  if (![value isKindOfClass:[NSNumber class]]) {
    return defaultValue;
  }

  return MAX((NSInteger)0, [(NSNumber *)value integerValue]);
}

double GetDoubleOption(NSDictionary *options, NSString *key, double defaultValue) {
  id value = options[key];
  if (![value isKindOfClass:[NSNumber class]]) {
    return defaultValue;
  }

  return MAX(1.0, [(NSNumber *)value doubleValue]);
}

BOOL GetBooleanOption(NSDictionary *options, NSString *key, BOOL defaultValue) {
  id value = options[key];
  if (![value isKindOfClass:[NSNumber class]]) {
    return defaultValue;
  }

  return [(NSNumber *)value boolValue];
}

NSString *GetStringOption(NSDictionary *options, NSString *key, NSString *defaultValue) {
  id value = options[key];
  if (![value isKindOfClass:[NSString class]]) {
    return defaultValue;
  }

  NSString *stringValue = (NSString *)value;
  return stringValue.length > 0 ? stringValue : defaultValue;
}

NSArray<NSString *> *GetRecognitionLanguages(NSDictionary *options) {
  id rawLanguages = options[@"languages"];
  if (![rawLanguages isKindOfClass:[NSArray class]]) {
    return @[ @"en-US", @"zh-Hans", @"zh-Hant", @"ja-JP", @"ko-KR" ];
  }

  NSMutableArray<NSString *> *languages = [NSMutableArray array];
  for (id value in (NSArray *)rawLanguages) {
    if ([value isKindOfClass:[NSString class]] && ((NSString *)value).length > 0) {
      [languages addObject:(NSString *)value];
    }
  }

  if (languages.count == 0) {
    return @[ @"en-US", @"zh-Hans", @"zh-Hant", @"ja-JP", @"ko-KR" ];
  }

  return languages;
}

CGSize GetRenderSize(CGRect bounds, double targetDpi, NSInteger maxDimension) {
  double scale = targetDpi / 72.0;
  double renderWidth = ceil(bounds.size.width * scale);
  double renderHeight = ceil(bounds.size.height * scale);
  double largestDimension = std::max(renderWidth, renderHeight);

  if (maxDimension > 0 && largestDimension > (double)maxDimension) {
    double shrink = (double)maxDimension / largestDimension;
    renderWidth = floor(renderWidth * shrink);
    renderHeight = floor(renderHeight * shrink);
  }

  return CGSizeMake(MAX(1.0, renderWidth), MAX(1.0, renderHeight));
}

UIImage *RenderPageImage(PDFPage *page, double targetDpi, NSInteger maxDimension) {
  CGRect bounds = [page boundsForBox:kPDFDisplayBoxMediaBox];
  if (bounds.size.width <= 0 || bounds.size.height <= 0) {
    return nil;
  }

  CGSize renderSize = GetRenderSize(bounds, targetDpi, maxDimension);
  UIGraphicsImageRendererFormat *format = [UIGraphicsImageRendererFormat defaultFormat];
  format.scale = 1.0;
  format.opaque = YES;

  UIGraphicsImageRenderer *renderer = [[UIGraphicsImageRenderer alloc] initWithSize:renderSize format:format];
  return [renderer imageWithActions:^(UIGraphicsImageRendererContext *_Nonnull rendererContext) {
    CGContextRef context = rendererContext.CGContext;
    CGContextSetFillColorWithColor(context, [UIColor whiteColor].CGColor);
    CGContextFillRect(context, CGRectMake(0, 0, renderSize.width, renderSize.height));

    CGContextSaveGState(context);
    CGContextTranslateCTM(context, 0.0, renderSize.height);
    CGContextScaleCTM(context, renderSize.width / bounds.size.width, -renderSize.height / bounds.size.height);
    CGContextTranslateCTM(context, -bounds.origin.x, -bounds.origin.y);
    [page drawWithBox:kPDFDisplayBoxMediaBox toContext:context];
    CGContextRestoreGState(context);
  }];
}

NSString *RecognizeTextInImage(
    UIImage *image,
    NSArray<NSString *> *languages,
    VNRequestTextRecognitionLevel recognitionLevel,
    BOOL usesLanguageCorrection,
    BOOL automaticallyDetectsLanguage) {
  CGImageRef cgImage = image.CGImage;
  if (cgImage == nullptr) {
    return @"";
  }

  VNRecognizeTextRequest *request = [[VNRecognizeTextRequest alloc] init];
  request.recognitionLevel = recognitionLevel;
  request.usesLanguageCorrection = usesLanguageCorrection;
  request.automaticallyDetectsLanguage = automaticallyDetectsLanguage;
  request.recognitionLanguages = languages;

  VNImageRequestHandler *handler = [[VNImageRequestHandler alloc] initWithCGImage:cgImage options:@{}];
  NSError *requestError = nil;
  if (![handler performRequests:@[ request ] error:&requestError] || requestError != nil) {
    ThrowWithMessage(requestError.localizedDescription ?: @"Vision text recognition failed.");
  }

  NSMutableArray<NSString *> *lines = [NSMutableArray array];
  for (VNRecognizedTextObservation *observation in request.results ?: @[]) {
    VNRecognizedText *candidate = [[observation topCandidates:1] firstObject];
    if (candidate.string.length > 0) {
      [lines addObject:candidate.string];
    }
  }

  return [lines componentsJoinedByString:@"\n"];
}

} // namespace

@implementation DocumentOcrModule

RCT_EXPORT_MODULE(DocumentOcr)

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (NSDictionary *)constantsToExport
{
  return @{ @"isConfigured": @YES };
}

RCT_REMAP_METHOD(recognizePdfText,
                 recognizePdfText:(NSString *)filePath
                 options:(NSDictionary *)options
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    @autoreleasepool {
      try {
        CFAbsoluteTime operationStartedAt = CFAbsoluteTimeGetCurrent();
        NSString *normalizedPath = NormalizePath(filePath);
        if (normalizedPath.length == 0) {
          ThrowWithMessage(@"A PDF file path is required for OCR.");
        }

        BOOL isDirectory = NO;
        if (![[NSFileManager defaultManager] fileExistsAtPath:normalizedPath isDirectory:&isDirectory] || isDirectory) {
          ThrowWithMessage([NSString stringWithFormat:@"PDF file not found: %@", normalizedPath]);
        }

        NSURL *fileURL = [NSURL fileURLWithPath:normalizedPath];
        PDFDocument *document = [[PDFDocument alloc] initWithURL:fileURL];
        if (document == nil) {
          ThrowWithMessage(@"Failed to open the PDF for OCR fallback.");
        }

        if (document.isLocked) {
          ThrowWithMessage(@"Password-protected PDFs are not supported by OCR fallback.");
        }

        NSInteger pageCount = document.pageCount;
        if (pageCount <= 0) {
          ThrowWithMessage(@"The selected PDF does not contain any pages.");
        }

        NSDictionary *normalizedOptions = [options isKindOfClass:[NSDictionary class]] ? options : @{};
        NSInteger accurateRetryMaxPages = GetIntegerOption(normalizedOptions, @"accurateRetryMaxPages", 0);
        NSInteger accurateRetryMinCharsPerPage = GetIntegerOption(normalizedOptions, @"accurateRetryMinCharsPerPage", 0);
        NSInteger requestedMaxPages = GetIntegerOption(normalizedOptions, @"maxPages", 0);
        NSInteger pagesToProcess = requestedMaxPages > 0 ? MIN(requestedMaxPages, pageCount) : pageCount;
        NSInteger maxDimension = GetIntegerOption(normalizedOptions, @"maxDimension", 2200);
        double targetDpi = GetDoubleOption(normalizedOptions, @"targetDpi", 144.0);
        NSArray<NSString *> *languages = GetRecognitionLanguages(normalizedOptions);
        NSString *recognitionLevelOption = [GetStringOption(normalizedOptions, @"recognitionLevel", @"fast") lowercaseString];
        BOOL usesLanguageCorrection = GetBooleanOption(normalizedOptions, @"usesLanguageCorrection", NO);
        BOOL automaticallyDetectsLanguage = GetBooleanOption(normalizedOptions, @"automaticallyDetectsLanguage", NO);
        VNRequestTextRecognitionLevel recognitionLevel =
          [recognitionLevelOption isEqualToString:@"accurate"]
            ? VNRequestTextRecognitionLevelAccurate
            : VNRequestTextRecognitionLevelFast;

        NSMutableArray<NSString *> *pageTexts = [NSMutableArray array];
  NSInteger accurateRetryBudget = accurateRetryMaxPages;
  NSInteger accurateRetriedPages = 0;
  NSInteger accurateRetrySelectedPages = 0;
  double totalAccurateRetryElapsedMs = 0.0;
        double totalRenderElapsedMs = 0.0;
        double totalRecognitionElapsedMs = 0.0;
        for (NSInteger index = 0; index < pagesToProcess; index += 1) {
          @autoreleasepool {
            PDFPage *page = [document pageAtIndex:index];
            if (page != nil) {
              CFAbsoluteTime renderStartedAt = CFAbsoluteTimeGetCurrent();
              UIImage *pageImage = RenderPageImage(page, targetDpi, maxDimension);
              totalRenderElapsedMs += (CFAbsoluteTimeGetCurrent() - renderStartedAt) * 1000.0;
              if (pageImage != nil) {
                CFAbsoluteTime recognitionStartedAt = CFAbsoluteTimeGetCurrent();
                NSString *pageText = RecognizeTextInImage(
                    pageImage,
                    languages,
                    recognitionLevel,
                    usesLanguageCorrection,
                    automaticallyDetectsLanguage);
                totalRecognitionElapsedMs += (CFAbsoluteTimeGetCurrent() - recognitionStartedAt) * 1000.0;
                NSString *selectedPageText = [pageText stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];

                BOOL shouldRetryAccurate =
                    recognitionLevel == VNRequestTextRecognitionLevelFast &&
                    accurateRetryBudget > 0 &&
                    accurateRetryMinCharsPerPage > 0 &&
                    selectedPageText.length < accurateRetryMinCharsPerPage;

                if (shouldRetryAccurate) {
                  accurateRetriedPages += 1;
                  accurateRetryBudget -= 1;

                  CFAbsoluteTime accurateRetryStartedAt = CFAbsoluteTimeGetCurrent();
                  NSString *accuratePageText = RecognizeTextInImage(
                      pageImage,
                      languages,
                      VNRequestTextRecognitionLevelAccurate,
                      usesLanguageCorrection,
                      automaticallyDetectsLanguage);
                  totalAccurateRetryElapsedMs +=
                      (CFAbsoluteTimeGetCurrent() - accurateRetryStartedAt) * 1000.0;

                  NSString *trimmedAccuratePageText =
                      [accuratePageText stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
                  if (trimmedAccuratePageText.length > selectedPageText.length) {
                    selectedPageText = trimmedAccuratePageText;
                    accurateRetrySelectedPages += 1;
                  }
                }

                if (selectedPageText.length > 0) {
                  [pageTexts addObject:[NSString stringWithFormat:@"[Page %ld]\n%@", (long)(index + 1), selectedPageText]];
                }
              }
            }
          }
        }

        NSString *text = [pageTexts componentsJoinedByString:@"\n\n"];
        double elapsedMs = (CFAbsoluteTimeGetCurrent() - operationStartedAt) * 1000.0;
        double averageMsPerPage = pagesToProcess > 0 ? elapsedMs / (double)pagesToProcess : 0.0;
        resolve(@{
          @"accurateRetriedPages": @(accurateRetriedPages),
          @"accurateRetryElapsedMs": @(totalAccurateRetryElapsedMs),
          @"accurateRetrySelectedPages": @(accurateRetrySelectedPages),
          @"averageMsPerPage": @(averageMsPerPage),
          @"engine": @"vision-pdfkit",
          @"elapsedMs": @(elapsedMs),
          @"pageCount": @(pageCount),
          @"pagesProcessed": @(pagesToProcess),
          @"recognitionElapsedMs": @(totalRecognitionElapsedMs),
          @"renderElapsedMs": @(totalRenderElapsedMs),
          @"text": text ?: @"",
        });
      } catch (const std::exception &error) {
        reject(@"E_PDF_OCR", NSStringFromStdException(error), nil);
      }
    }
  });
}

@end