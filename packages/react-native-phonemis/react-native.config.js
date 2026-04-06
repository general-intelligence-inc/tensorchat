module.exports = {
  dependency: {
    platforms: {
      android: {
        sourceDir: './android',
        packageImportPath: 'import com.reactnativephonemis.PhonemisPackage;',
        packageInstance: 'new PhonemisPackage()',
      },
      ios: {
        podspecPath: './react-native-phonemis.podspec',
      },
    },
  },
};