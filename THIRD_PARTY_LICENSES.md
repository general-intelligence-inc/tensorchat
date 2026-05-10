# Third-Party Licenses

TensorChat first-party source code in this repository is licensed under
[Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0). The shipped iOS and
Android applications additionally bundle third-party native libraries listed
below, each retaining its own license.

If you redistribute or modify the application, you must comply with the terms
of every component listed here. Where a component's license requires that
recipients be informed and given access to corresponding source, you can find
links to upstream sources alongside each entry.

## Native runtime libraries

| Component | License | Source |
|---|---|---|
| `llama.rn` (TensorChat fork of cui-ai/llama.rn) | MIT | https://github.com/cui-ai/llama.rn |
| `onnxruntime-react-native` (and the underlying ONNX Runtime C/C++ library) | MIT | https://github.com/microsoft/onnxruntime |
| `react-native-sherpa-voice` (this repo: `packages/react-native-sherpa-voice/`) — wraps sherpa-onnx | Apache-2.0 | https://github.com/k2-fsa/sherpa-onnx |
| `react-native-document-ocr` (this repo: `packages/react-native-document-ocr/`) | Apache-2.0 | local |
| `react-native-phonemis` (this repo: `packages/react-native-phonemis/`) | Apache-2.0 | local |
| `react-native-pdfium` | Apache-2.0 | https://github.com/software-mansion-labs/private-mind |
| `op-sqlite` (and SQLiteVec / libSQL extensions) | MIT | https://github.com/OP-Engineering/op-sqlite |
| `react-native-fs` | MIT | https://github.com/itinance/react-native-fs |
| `react-native-zip-archive` | MIT | https://github.com/mockingbot/react-native-zip-archive |
| `react-native-audio-api` | MIT | https://github.com/software-mansion/react-native-audio-api |
| Expo SDK modules | MIT | https://github.com/expo/expo |

## Image generation

Image generation runs through `onnxruntime-react-native` (already listed
above) plus first-party TypeScript code under `src/imagegen/` (a CLIP-ViT-L/14
BPE tokenizer, a DDIM sampler, and a 24-bit BMP encoder), all under
Apache-2.0. There is no GPL surface in the image-gen path.

## Model weights (downloaded by the user, not bundled)

The application downloads the following model families on demand. Each model's
weights are licensed by their respective authors; downloading them through the
in-app catalog is subject to the original license shown by the upstream host.

- Qwen 3.5 family — Qwen License (Tongyi Qianwen)
- Google Gemma 4 family — Gemma Terms of Use
- NVIDIA Nemotron 3 Nano — NVIDIA Open Model License
- LFM2 (Liquid AI) — Liquid AI Open License
- PrismML Bonsai 8B — Apache-2.0
- EmbeddingGemma — Gemma Terms of Use
- Kokoro TTS — Apache-2.0
- Whisper (via sherpa-onnx) — MIT
- Piper TTS (via sherpa-onnx) — MIT
- EuroLLM — Apache-2.0
- TranslateGemma — Gemma Terms of Use
- Stable Diffusion 1.5 (with LCM scheduler) — CreativeML Open RAIL-M (image-gen model)
- Other Stable Diffusion / SDXL / Flux variants if loaded — see each model card on Hugging Face

## Updating this list

When adding a new bundled native dependency, append a row above and reference
its upstream source. When adding a new in-app downloadable model, add it to
the model weights section so users can find its license in one place.
