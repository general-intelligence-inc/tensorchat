# react-native-phonemis

Local React Native bridge for a Phonemis-based grapheme-to-phoneme (G2P) runtime. Converts text into IPA phonemes on-device, used upstream of TTS pipelines that expect phonemic input (e.g. Kokoro).

This package is developed inside the [TensorChat](https://github.com/general-intelligence-inc/tensorchat) monorepo and is not published to npm. It's linked locally via `file:packages/react-native-phonemis`.

## Platforms

- iOS
- Android

## Usage

```ts
import { phonemize } from 'react-native-phonemis';

const phonemes = await phonemize('Hello, world.', 'en_us');
// → "həlˈoʊ, wˈɜːld."
```

## API

- `phonemize(text, locale?)` — returns a promise of the phoneme string
- `clearCaches()` — drops any internal caches
- `isAvailable` — runtime flag, `false` when the native module isn't linked

Supported locales: `en_us`, `en_gb` (also accept `en-us` / `en-gb`).

See [`index.d.ts`](index.d.ts) for full type definitions.

## License

MIT. Bundled phoneme dictionaries and vendor assets are licensed separately by their upstream authors — see `vendor/` and `assets/` for details.
