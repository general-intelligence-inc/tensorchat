Pod::Spec.new do |s|
  s.name = 'react-native-phonemis'
  s.version = '0.1.0'
  s.summary = 'Local React Native bridge for the Phonemis G2P runtime.'
  s.license = { :type => 'MIT', :file => 'vendor/phonemis-LICENSE' }
  s.homepage = 'https://github.com/IgorSwat/Phonemis'
  s.author = { 'TensorChat' => 'local' }
  s.platforms = { :ios => '15.1' }
  s.source = { :path => '.' }
  s.requires_arc = true

  s.source_files = [
    'ios/**/*.{h,m,mm}',
    'vendor/phonemis/src/*.cpp',
    'vendor/phonemis/include/**/*.{h,hpp}'
  ]
  s.preserve_paths = [
    'vendor/phonemis/include/**/*',
    'vendor/phonemis/src/**/*',
    'assets/phonemis/*.json'
  ]
  s.resources = ['assets/phonemis/*.json']

  s.pod_target_xcconfig = {
    'CLANG_CXX_LANGUAGE_STANDARD' => 'gnu++20',
    'CLANG_CXX_LIBRARY' => 'libc++',
    'HEADER_SEARCH_PATHS' => '"$(PODS_TARGET_SRCROOT)/vendor/phonemis/include"',
    'OTHER_CPLUSPLUSFLAGS' => '$(inherited) -std=gnu++20'
  }

  s.dependency 'React-Core'
end