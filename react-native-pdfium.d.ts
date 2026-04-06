declare module 'react-native-pdfium' {
  export function readPDF(path: string): Promise<string>;
}