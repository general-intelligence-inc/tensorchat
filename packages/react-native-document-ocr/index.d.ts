export interface RecognizePdfTextOptions {
  accurateRetryMaxPages?: number;
  accurateRetryMinCharsPerPage?: number;
  automaticallyDetectsLanguage?: boolean;
  languages?: string[];
  maxDimension?: number;
  maxPages?: number;
  recognitionLevel?: 'accurate' | 'fast';
  targetDpi?: number;
  usesLanguageCorrection?: boolean;
}

export interface RecognizePdfTextResult {
  accurateRetriedPages: number;
  accurateRetryElapsedMs: number;
  accurateRetrySelectedPages: number;
  averageMsPerPage: number;
  engine: string;
  elapsedMs: number;
  pageCount: number;
  pagesProcessed: number;
  recognitionElapsedMs: number;
  renderElapsedMs: number;
  text: string;
}

export const isAvailable: boolean;
export const isConfigured: boolean;

export function recognizePdfText(
  filePath: string,
  options?: RecognizePdfTextOptions,
): Promise<RecognizePdfTextResult>;