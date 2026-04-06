module.exports = {
  dependency: {
    platforms: {
      android: {
        sourceDir: './android',
        packageImportPath: 'import com.reactnativedocumentocr.DocumentOcrPackage;',
        packageInstance: 'new DocumentOcrPackage()',
      },
      ios: {
        podspecPath: './react-native-document-ocr.podspec',
      },
    },
  },
};