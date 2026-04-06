Pod::Spec.new do |s|
  s.name = 'react-native-document-ocr'
  s.version = '0.1.0'
  s.summary = 'Local React Native bridge for on-device PDF OCR fallback.'
  s.license = { :type => 'MIT' }
  s.homepage = 'https://developer.apple.com/documentation/vision'
  s.author = { 'TensorChat' => 'local' }
  s.platforms = { :ios => '15.1' }
  s.source = { :path => '.' }
  s.requires_arc = true

  s.source_files = 'ios/**/*.{h,m,mm}'
  s.frameworks = ['Foundation', 'PDFKit', 'UIKit', 'Vision']

  s.dependency 'React-Core'
end