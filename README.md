# TensorChat

<p align="center">
  <img src="assets/social-preview.png" alt="TensorChat — Private AI. Intelligence on your terms." width="100%" />
</p>

[![Website](https://img.shields.io/badge/Website-tensorchat.app-111?logo=safari&logoColor=white)](https://tensorchat.app)
[![App Store](https://img.shields.io/badge/App_Store-TensorChat-0D96F6?logo=apple)](https://apps.apple.com/us/app/tensorchat-private-ai/id6760141754)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

A private, on-device AI chatbot for iOS and Android. All LLM inference runs locally via a [llama.rn fork](https://github.com/zhi-x-ye/llama.rn) (based on [mybigday/llama.rn](https://github.com/mybigday/llama.rn)). No accounts, no telemetry, no cloud calls by default.

## Features

- 🔒 **On-device everything** — chat, vision, voice, and RAG all run locally. The only network calls are optional: model downloads from HuggingFace and per-chat DuckDuckGo web search
- 🖼️ **Vision** — drop in an image and ask about it (multimodal models: Qwen3.5, Gemma 4)
- 🎙️ **Voice I/O** — on-device speech-to-text and text-to-speech via [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) and Kokoro TTS
- 📄 **File RAG** — ingest PDFs and documents into a local vector store (op-sqlite + embeddings), with on-device OCR fallback for scanned PDFs
- 🧠 **Thinking mode** — streamed chain-of-thought reasoning on models that support it
- 🔧 **Tool calling** — built-in web search tool, callable by the model
- ⚡ **Streaming tokens** — real-time generation with thinking/answer separation
- 📦 **In-app model catalog** — browse, download, and swap models without leaving the app

## Supported Models

All models are GGUF builds sourced from HuggingFace and loaded via our [llama.rn fork](https://github.com/zhi-x-ye/llama.rn).

| Family | Sizes | Vision | Source |
|---|---|---|---|
| **Qwen3.5** | 0.8B, 2B, 4B | ✅ | [unsloth/Qwen3.5-\*-GGUF](https://huggingface.co/unsloth) |
| **Gemma 4 E2B** | 2B effective | ✅ | [unsloth/gemma-4-E2B-it-GGUF](https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF) |
| **LFM2.5** | 350M, 1.2B | — | [LiquidAI/LFM2.5-\*-GGUF](https://huggingface.co/LiquidAI) |

Quantizations offered per model: `Q3_K_M`, `Q4_K_M` (recommended default), `Q8_0`, `BF16`, `UD_IQ2_M`. Smaller quantizations run on older devices at the cost of quality.

The full catalog is defined in [`src/constants/models.ts`](src/constants/models.ts).

## Getting Started

### Prerequisites

- Node.js 18+
- Xcode (for iOS) or Android Studio (for Android)
- A physical device or simulator/emulator
- [CocoaPods](https://cocoapods.org/) for iOS

> Expo Go is **not** supported — the llama.rn fork is a native module and requires a [development build](https://docs.expo.dev/develop/development-builds/introduction/).

### Install and run

```bash
git clone https://github.com/general-intelligence-inc/tensorchat.git
cd tensorchat
npm install

# Start the Expo dev server
npm start

# Build & run on a device/simulator
npm run ios      # iOS
npm run android  # Android
```

### Local iOS release build

For a release-like local build that mirrors the production EAS profile:

```bash
# Also requires Fastlane on your PATH: brew install fastlane
npm run build:release-like:ios:local
```

This uses a repo-local npm cache at `.npm-cache/` so it still works even if your global `~/.npm` cache has been corrupted by a past `sudo npm`.

## Usage

1. On first launch, open the **model catalog** from the sidebar.
2. Pick a model (start with **Qwen3.5-0.8B Q4_K_M** for fast devices, **LFM2.5-350M** for older ones).
3. Tap **Download** — models are written to the app's document directory.
4. Tap **Load** to initialize the model in memory.
5. Start chatting. Attach images for vision, use the mic for voice, or open **File Vault** to ingest documents for RAG.

## Project Structure

```
src/
├── components/           # Reusable UI (Sidebar, ChatInput, ModelPickerDropdown, ...)
├── constants/
│   ├── models.ts         # Model catalog + quantization config
│   └── theme.ts          # Design tokens (colors, spacing)
├── context/              # React contexts (Llama, Theme, FileRag)
├── hooks/
│   ├── useLlama.ts       # Model loading, streaming inference, vision, tool calling
│   ├── useVoice.ts       # STT/TTS pipeline (sherpa-onnx + Kokoro)
│   ├── useFileRag.ts     # Document ingestion, embedding, vector search
│   └── useEmbeddingModelAsset.ts
├── navigation/           # React Navigation container
├── screens/
│   ├── ChatScreen.tsx        # Main chat UI with streaming + sidebar
│   ├── ModelCatalogScreen.tsx # Browse / download / manage models
│   └── FileVaultScreen.tsx   # Document ingestion for RAG
├── types/                # Shared type definitions
└── utils/                # File readers, web search, boot tracing, ...

packages/                 # First-party native bridges
├── react-native-sherpa-voice/    # Apache-2.0 — on-device STT/TTS
├── react-native-phonemis/        # MIT — G2P for TTS
└── react-native-document-ocr/    # MIT — PDF OCR fallback

web/                      # Separate Vite + React web build (no native LLM)
```

See [`AGENTS.md`](AGENTS.md) for the architecture guide, constraints, and patterns to preserve.

## Privacy

TensorChat is private by design:

- All LLM inference, voice, vision, embeddings, and RAG run on-device
- Zero analytics, crash reporting, or telemetry
- No user accounts, no sign-in
- Chat history and RAG documents stay on-device (AsyncStorage + op-sqlite)
- Network is only touched for: (1) downloading models from HuggingFace, (2) DuckDuckGo web search *when explicitly enabled per-chat*

## Contributing

We're **not accepting pull requests at this time**, but we welcome bug reports and feature requests via [GitHub Issues](https://github.com/general-intelligence-inc/tensorchat/issues). See [CONTRIBUTING.md](CONTRIBUTING.md).

Security vulnerabilities: see [SECURITY.md](SECURITY.md) — please use GitHub Private Vulnerability Reporting rather than public issues.

## License

Apache-2.0. See [LICENSE](LICENSE).

Third-party runtimes and models (llama.rn fork, sherpa-onnx, Qwen, Gemma, LFM2.5, Kokoro) are licensed by their respective upstream authors. See [`zhi-x-ye/llama.rn`](https://github.com/zhi-x-ye/llama.rn) for the specific llama.rn fork used by this project.
