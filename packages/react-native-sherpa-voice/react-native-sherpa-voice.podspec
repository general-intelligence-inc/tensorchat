Pod::Spec.new do |s|
  s.name = 'react-native-sherpa-voice'
  s.version = '0.1.0'
  s.summary = 'Local React Native bridge for the sherpa-onnx voice runtime.'
  s.license = { :type => 'Apache-2.0' }
  s.homepage = 'https://github.com/k2-fsa/sherpa-onnx'
  s.author = { 'TensorChat' => 'local' }
  s.platforms = { :ios => '15.1' }
  s.source = { :path => '.' }
  s.requires_arc = true

  s.source_files = 'ios/**/*.{h,m,mm}'
  s.preserve_paths = ['ios/vendor/build-ios/sherpa-onnx.xcframework']
  s.vendored_frameworks = ['ios/vendor/build-ios/sherpa-onnx.xcframework']
  s.frameworks = 'Foundation'
  s.libraries = 'c++'

  s.pod_target_xcconfig = {
    'CLANG_CXX_LANGUAGE_STANDARD' => 'gnu++20',
    'CLANG_CXX_LIBRARY' => 'libc++',
    'HEADER_SEARCH_PATHS' => '$(inherited) "$(PODS_TARGET_SRCROOT)/ios/vendor/build-ios/sherpa-onnx.xcframework/Headers"',
    'OTHER_CPLUSPLUSFLAGS' => '$(inherited) -std=gnu++20',
    'OTHER_LDFLAGS' => '$(inherited) -lc++'
  }

  s.dependency 'React-Core'
  s.dependency 'onnxruntime-c'
end