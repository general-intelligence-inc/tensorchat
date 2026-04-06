module.exports = {
  dependency: {
    platforms: {
      android: {
        sourceDir: './android',
        packageImportPath: 'import com.reactnativesherpavoice.SherpaVoicePackage;',
        packageInstance: 'new SherpaVoicePackage()',
      },
      ios: {
        podspecPath: './react-native-sherpa-voice.podspec',
      },
    },
  },
};