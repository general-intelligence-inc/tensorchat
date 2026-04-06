import * as FileSystem from 'expo-file-system/legacy';
import type { RagSourceType } from '../types/fileRag';
import { optionalRequire } from './optionalRequire';

type ReadPdfFn = (path: string) => Promise<string>;
type RecognizePdfTextFn = (
  path: string,
  options?: {
    accurateRetryMaxPages?: number;
    accurateRetryMinCharsPerPage?: number;
    automaticallyDetectsLanguage?: boolean;
    languages?: string[];
    maxDimension?: number;
    maxPages?: number;
    recognitionLevel?: 'accurate' | 'fast';
    targetDpi?: number;
    usesLanguageCorrection?: boolean;
  },
) => Promise<{
  accurateRetriedPages?: number;
  accurateRetryElapsedMs?: number;
  accurateRetrySelectedPages?: number;
  averageMsPerPage?: number;
  engine?: string;
  elapsedMs?: number;
  pageCount?: number;
  pagesProcessed?: number;
  recognitionElapsedMs?: number;
  renderElapsedMs?: number;
  text: string;
}>;

interface SupportedDocumentDefinition {
  sourceType: RagSourceType;
  label: string;
  extensions: readonly string[];
  mimeTypes: readonly string[];
}

let readPDF: ReadPdfFn | null = null;
let recognizePdfText: RecognizePdfTextFn | null = null;

const pdfiumModule = optionalRequire<{ readPDF: ReadPdfFn }>(() => require('react-native-pdfium'));
const documentOcrModule = optionalRequire<{
  isAvailable?: boolean;
  recognizePdfText: RecognizePdfTextFn;
}>(() => require('react-native-document-ocr'));

const PDF_OCR_FALLBACK_LANGUAGES = ['en-US', 'zh-Hans', 'zh-Hant', 'ja-JP', 'ko-KR'];
const PDF_OCR_FALLBACK_RECOGNITION_LEVEL = 'fast';
const PDF_OCR_FALLBACK_USES_LANGUAGE_CORRECTION = false;
const PDF_OCR_FALLBACK_AUTOMATIC_LANGUAGE_DETECTION = false;
const PDF_OCR_FALLBACK_ACCURATE_RETRY_MAX_PAGES = 0;
const PDF_OCR_FALLBACK_ACCURATE_RETRY_MIN_CHARS_PER_PAGE = 260;
const PDF_OCR_FALLBACK_MAX_DIMENSION = 2000;
const PDF_OCR_FALLBACK_TARGET_DPI = 160;

if (pdfiumModule) {
  readPDF = pdfiumModule.readPDF;
} else {
  console.warn('[FileRAG] react-native-pdfium not available in this environment');
}

if (documentOcrModule && (documentOcrModule.isAvailable ?? false)) {
  recognizePdfText = documentOcrModule.recognizePdfText;
}

export const SUPPORTED_DOCUMENTS: readonly SupportedDocumentDefinition[] = [
  {
    sourceType: 'pdf',
    label: 'PDF',
    extensions: ['pdf'],
    mimeTypes: ['application/pdf'],
  },
  {
    sourceType: 'txt',
    label: 'TXT',
    extensions: ['txt'],
    mimeTypes: ['text/plain'],
  },
  {
    sourceType: 'md',
    label: 'Markdown',
    extensions: ['md', 'markdown'],
    mimeTypes: ['text/markdown', 'text/x-markdown'],
  },
  {
    sourceType: 'html',
    label: 'HTML',
    extensions: ['html', 'htm'],
    mimeTypes: ['text/html'],
  },
];

function normalizeMimeTypeValue(mimeType: string): string {
  return mimeType.split(';', 1)[0].trim().toLowerCase();
}

function formatLabelList(values: readonly string[]): string {
  if (values.length === 0) {
    return '';
  }

  if (values.length === 1) {
    return values[0];
  }

  if (values.length === 2) {
    return `${values[0]} or ${values[1]}`;
  }

  return `${values.slice(0, -1).join(', ')}, or ${values[values.length - 1]}`;
}

const supportedDocumentEntries = SUPPORTED_DOCUMENTS.flatMap(
  ({ sourceType, extensions, mimeTypes }) => ({
    sourceType,
    extensions,
    mimeTypes: mimeTypes.map(normalizeMimeTypeValue),
  }),
);

const supportedDocumentExtensionMap = new Map<string, RagSourceType>(
  supportedDocumentEntries.flatMap(({ sourceType, extensions }) =>
    extensions.map((extension) => [extension.toLowerCase(), sourceType] as const),
  ),
);

const supportedDocumentMimeTypeMap = new Map<string, RagSourceType>(
  supportedDocumentEntries.flatMap(({ sourceType, mimeTypes }) =>
    mimeTypes.map((mimeType) => [mimeType, sourceType] as const),
  ),
);

export const SUPPORTED_DOCUMENT_MIME_TYPES = Array.from(
  new Set(
    supportedDocumentEntries.flatMap(({ mimeTypes }) => mimeTypes),
  ),
);

export const SUPPORTED_DOCUMENT_LABEL_TEXT = formatLabelList(
  SUPPORTED_DOCUMENTS.map(({ label }) => label),
);

export function getSupportedDocumentPickerTypes(): string[] {
  return [...SUPPORTED_DOCUMENT_MIME_TYPES];
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function stripHtml(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeNativeFilePath(filePath: string): string {
  return filePath.startsWith('file://') ? filePath.slice(7) : filePath;
}

function getFileLogLabel(filePath: string): string {
  const normalizedPath = normalizeNativeFilePath(filePath);
  const pathParts = normalizedPath.split('/');
  return pathParts[pathParts.length - 1] || normalizedPath;
}

function normalizeExtension(extension: string): RagSourceType | null {
  return supportedDocumentExtensionMap.get(extension.toLowerCase()) ?? null;
}

export function normalizeSourceType(
  fileName: string,
  mimeType?: string | null,
): RagSourceType | null {
  const nameParts = fileName.split('.');
  const extension = nameParts.length > 1 ? nameParts[nameParts.length - 1] : '';
  const fromExtension = normalizeExtension(extension);

  if (fromExtension) {
    return fromExtension;
  }

  if (!mimeType) {
    return null;
  }

  return supportedDocumentMimeTypeMap.get(normalizeMimeTypeValue(mimeType)) ?? null;
}

export async function readDocumentText(
  filePath: string,
  fileType: RagSourceType,
): Promise<string> {
  switch (fileType) {
    case 'pdf': {
      const normalizedPath = normalizeNativeFilePath(filePath);
      const fileLabel = getFileLogLabel(normalizedPath);
      let pdfExtractionError: Error | null = null;

      if (readPDF) {
        const pdfExtractionStartedAt = Date.now();

        try {
          const extractedText = await readPDF(normalizedPath);
          const pdfExtractionElapsedMs = Date.now() - pdfExtractionStartedAt;

          if (extractedText.trim().length > 0) {
            console.log('[FileRAG] PDF text extraction succeeded:', {
              elapsedMs: pdfExtractionElapsedMs,
              file: fileLabel,
              extractor: 'pdfium',
              textLength: extractedText.length,
            });
            return extractedText;
          }

          console.log('[FileRAG] PDF text extraction returned no text, trying OCR fallback:', {
            elapsedMs: pdfExtractionElapsedMs,
            file: fileLabel,
            extractor: 'pdfium',
          });
        } catch (error) {
          const pdfExtractionElapsedMs = Date.now() - pdfExtractionStartedAt;
          pdfExtractionError = error instanceof Error ? error : new Error(String(error));
          console.warn('[FileRAG] PDF text extraction failed, trying OCR fallback:', {
            elapsedMs: pdfExtractionElapsedMs,
            file: fileLabel,
            extractor: 'pdfium',
            error: pdfExtractionError.message,
          });
        }
      }

      if (recognizePdfText) {
        const ocrStartedAt = Date.now();

        console.log('[FileRAG] OCR fallback started:', {
          accurateRetryMaxPages: PDF_OCR_FALLBACK_ACCURATE_RETRY_MAX_PAGES,
          accurateRetryMinCharsPerPage: PDF_OCR_FALLBACK_ACCURATE_RETRY_MIN_CHARS_PER_PAGE,
          file: fileLabel,
          recognitionLevel: PDF_OCR_FALLBACK_RECOGNITION_LEVEL,
          usesLanguageCorrection: PDF_OCR_FALLBACK_USES_LANGUAGE_CORRECTION,
          automaticallyDetectsLanguage: PDF_OCR_FALLBACK_AUTOMATIC_LANGUAGE_DETECTION,
          languages: PDF_OCR_FALLBACK_LANGUAGES,
          maxDimension: PDF_OCR_FALLBACK_MAX_DIMENSION,
          targetDpi: PDF_OCR_FALLBACK_TARGET_DPI,
        });

        try {
          const ocrResult = await recognizePdfText(normalizedPath, {
            accurateRetryMaxPages: PDF_OCR_FALLBACK_ACCURATE_RETRY_MAX_PAGES,
            accurateRetryMinCharsPerPage: PDF_OCR_FALLBACK_ACCURATE_RETRY_MIN_CHARS_PER_PAGE,
            automaticallyDetectsLanguage: PDF_OCR_FALLBACK_AUTOMATIC_LANGUAGE_DETECTION,
            languages: PDF_OCR_FALLBACK_LANGUAGES,
            maxDimension: PDF_OCR_FALLBACK_MAX_DIMENSION,
            recognitionLevel: PDF_OCR_FALLBACK_RECOGNITION_LEVEL,
            targetDpi: PDF_OCR_FALLBACK_TARGET_DPI,
            usesLanguageCorrection: PDF_OCR_FALLBACK_USES_LANGUAGE_CORRECTION,
          });

          const ocrElapsedMs = Date.now() - ocrStartedAt;

          console.log('[FileRAG] OCR fallback finished:', {
            accurateRetriedPages: ocrResult.accurateRetriedPages ?? null,
            accurateRetryElapsedMs: ocrResult.accurateRetryElapsedMs ?? null,
            accurateRetrySelectedPages: ocrResult.accurateRetrySelectedPages ?? null,
            averageMsPerPage: ocrResult.averageMsPerPage ?? null,
            elapsedMs: ocrElapsedMs,
            file: fileLabel,
            engine: ocrResult.engine ?? 'unknown',
            nativeElapsedMs: ocrResult.elapsedMs ?? null,
            pageCount: ocrResult.pageCount ?? null,
            pagesProcessed: ocrResult.pagesProcessed ?? null,
            recognitionElapsedMs: ocrResult.recognitionElapsedMs ?? null,
            renderElapsedMs: ocrResult.renderElapsedMs ?? null,
            textLength: ocrResult.text.length,
          });

          if (ocrResult.text.trim().length > 0) {
            return ocrResult.text;
          }

          console.warn('[FileRAG] OCR fallback returned no text:', {
            accurateRetriedPages: ocrResult.accurateRetriedPages ?? null,
            accurateRetryElapsedMs: ocrResult.accurateRetryElapsedMs ?? null,
            accurateRetrySelectedPages: ocrResult.accurateRetrySelectedPages ?? null,
            averageMsPerPage: ocrResult.averageMsPerPage ?? null,
            elapsedMs: ocrElapsedMs,
            file: fileLabel,
            engine: ocrResult.engine ?? 'unknown',
            nativeElapsedMs: ocrResult.elapsedMs ?? null,
            pageCount: ocrResult.pageCount ?? null,
            pagesProcessed: ocrResult.pagesProcessed ?? null,
            recognitionElapsedMs: ocrResult.recognitionElapsedMs ?? null,
            renderElapsedMs: ocrResult.renderElapsedMs ?? null,
          });

          throw new Error('No extractable text was found in this PDF, even after on-device OCR fallback.');
        } catch (ocrError) {
          const ocrElapsedMs = Date.now() - ocrStartedAt;
          console.warn('[FileRAG] OCR fallback failed:', {
            elapsedMs: ocrElapsedMs,
            file: fileLabel,
            error: ocrError instanceof Error ? ocrError.message : String(ocrError),
          });
          throw ocrError;
        }
      }

      if (pdfExtractionError) {
        throw pdfExtractionError;
      }

      if (!readPDF) {
        throw new Error('PDF extraction is not available on this platform.');
      }

      return '';
    }

    case 'txt':
    case 'md':
      return FileSystem.readAsStringAsync(filePath, {
        encoding: FileSystem.EncodingType.UTF8,
      });

    case 'html': {
      const html = await FileSystem.readAsStringAsync(filePath, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      return stripHtml(html);
    }
  }
}