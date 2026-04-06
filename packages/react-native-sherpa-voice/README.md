# react-native-sherpa-voice

Local React Native bridge for the [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) voice runtime. Provides on-device speech-to-text (STT) and text-to-speech (TTS) on iOS and Android.

This package is developed inside the [TensorChat](https://github.com/general-intelligence-inc/tensorchat) monorepo and is not published to npm. It's linked locally via `file:packages/react-native-sherpa-voice`.

## Platforms

- iOS
- Android

## Usage

```ts
import {
  loadSTTModel,
  transcribeFile,
  loadTTSModel,
  synthesize,
} from 'react-native-sherpa-voice';

// Speech-to-text
await loadSTTModel('/path/to/stt/model');
const { text } = await transcribeFile('/path/to/audio.wav');

// Text-to-speech
await loadTTSModel('/path/to/tts/model');
const { audioData, audioEncoding, sampleRate } = await synthesize('Hello world');
```

## API

- `loadSTTModel(modelPath, modelType?)` / `isSTTModelLoaded()` / `unloadSTTModel()`
- `transcribeFile(filePath, { language?, sampleRate? })`
- `loadTTSModel(modelPath, modelType?)` / `isTTSModelLoaded()` / `unloadTTSModel()`
- `synthesize(text, { voice?, rate?, pitch?, volume? })`
- `isConfigured` / `isAvailable` — runtime flags

See [`index.d.ts`](index.d.ts) for full type definitions.

## License

Apache-2.0. The bundled sherpa-onnx vendor code is licensed separately by its upstream authors.
