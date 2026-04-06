# react-native-document-ocr

On-device OCR fallback for PDF files in React Native. Renders PDF pages and runs platform-native text recognition (Apple Vision on iOS, ML Kit on Android) to extract text when direct PDF text extraction fails or returns too little.

This package is developed inside the [TensorChat](https://github.com/general-intelligence-inc/tensorchat) monorepo and is not published to npm. It's linked locally via `file:packages/react-native-document-ocr`.

## Platforms

- iOS (Apple Vision)
- Android (ML Kit)

## Usage

```ts
import { recognizePdfText } from 'react-native-document-ocr';

const result = await recognizePdfText('/path/to/document.pdf', {
  recognitionLevel: 'fast',
  maxPages: 50,
  automaticallyDetectsLanguage: true,
});

console.log(result.text);
console.log(`Processed ${result.pagesProcessed} pages in ${result.elapsedMs}ms`);
```

## API

```ts
recognizePdfText(filePath, options?): Promise<RecognizePdfTextResult>
```

Key options:

- `recognitionLevel` — `'fast'` (default) or `'accurate'`
- `maxPages` / `maxDimension` / `targetDpi` — control render size and throughput
- `languages` / `automaticallyDetectsLanguage` — language hints
- `accurateRetryMaxPages` / `accurateRetryMinCharsPerPage` — auto-retry low-yield pages in accurate mode
- `usesLanguageCorrection` — enable dictionary correction

Result includes extracted `text`, timing breakdown (`renderElapsedMs`, `recognitionElapsedMs`, `averageMsPerPage`), and counts of retried pages.

See [`index.d.ts`](index.d.ts) for full type definitions.

## License

MIT.
