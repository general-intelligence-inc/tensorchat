# TensorChat — Agent Instructions

## Mission and Product Promise

TensorChat is a privacy-first, fully on-device AI chat app for iOS and Android.

- All inference is local (`llama.rn`)
- No cloud LLM calls by default
- Users download models to device storage and chat offline

If a requested change conflicts with this promise, call out the conflict before implementing.

---

## Canonical App Configuration (Source of Truth)

Always treat `app.json` and `package.json` as canonical for runtime/platform facts.

- App name / slug: `TensorChat` / `tensorchat`
- Bundle/package IDs: `io.tensorpath.chat` (iOS + Android)
- Orientation: portrait (`orientation: "portrait"`)
- UI mode policy: automatic system appearance (`userInterfaceStyle: "automatic"`)
- Navigation: React Navigation (no Expo Router)

### Current appearance behavior

- Theme preference storage defaults to `system` in `ThemeContext`, so new UI and splash work should respect both light and dark appearances by default.

---

## Current Implementation Snapshot

### Core features (implemented)

| Feature | Primary location |
|---|---|
| Multi-chat threads + sidebar switching | `src/screens/ChatScreen.tsx`, `src/components/Sidebar.tsx` |
| Streaming generation updates | `src/hooks/useLlama.ts` -> `ChatScreen` state updates |
| Thinking mode (`<think>`) behavior | Prompt builder in `ChatScreen`, parser/rendering in `MessageBubble` |
| Multimodal image prompts (vision) | `ChatScreen` + structured messages in `useLlama` |
| GGUF download/scan/load/delete | `src/screens/ModelCatalogScreen.tsx` |
| Voice STT/TTS pipeline | `src/hooks/useVoice.ts`, `packages/react-native-sherpa-voice` |
| Auto-load previously selected model on app startup | `App.tsx` |
| Persisted chats and active thread | `ChatScreen` + AsyncStorage |
| Mini App Builder (artifact-first AI apps) | `src/agent/`, `src/miniapps/` |
| Agentic tool calling (ReAct loop) | `src/agent/Agent.ts`, `src/agent/llamaAdapter.ts` |
| Web search tool (DuckDuckGo) | `src/agent/tools/webSearch.ts`, `src/utils/webSearch.ts` |
| File Vault / RAG (document ingestion + vector search) | `src/hooks/useFileRag.ts`, `src/context/FileRagContext.tsx`, `src/screens/FileVaultScreen.tsx` |
| On-device embeddings (EmbeddingGemma) | `src/hooks/useEmbeddingModelAsset.ts` |

### Current model matrix

- Chat model families: Qwen3.5 (`0.8B`, `2B`, `4B`), Gemma 4 E2B, LFM2.5 (`350M`, `1.2B`)
- Quantizations currently supported: `Q3_K_M`, `Q4_K_M`, `Q8_0`, `BF16`, `UD_IQ2_M`
- Vision models include `mmproj` sidecar handling
- Gemma 4 E2B has `nativeReasoning: true` (uses native reasoning tokens, not `<think>` tags)
- Mini-app eligible models: Qwen 3.5 4B Q4_K_M (95% e2e), Gemma 4 E2B (Q4_K_M + IQ2_M)
- Embedding model: EmbeddingGemma 300M (Q4_0) for File Vault
- Translation models: EuroLLM 1.7B Q4, TranslateGemma 4B Q3
- Model metadata is generated via `buildModels()` in `src/constants/models.ts`

---

## Repository Structure (Current)

```
tensorchat/
├── App.tsx
├── app.json
├── package.json
├── src/
│   ├── agent/
│   │   ├── Agent.ts                  # ReAct agent loop
│   │   ├── llamaAdapter.ts           # Bridge to useLlama
│   │   ├── miniAppAgent.ts           # Mini-app agent builder + compaction
│   │   ├── miniAppPromptText.ts      # System prompt constants
│   │   ├── types.ts                  # Agent/Tool/Event types
│   │   └── tools/
│   │       ├── webSearch.ts
│   │       ├── writeMiniApp.ts
│   │       └── patchMiniApp.ts
│   ├── components/
│   │   ├── AppBootScreen.tsx
│   │   ├── CameraCaptureModal.tsx
│   │   ├── ChatEmptyState.tsx
│   │   ├── ChatHeader.tsx
│   │   ├── ChatInput.tsx
│   │   ├── ManagedAssetRow.tsx
│   │   ├── MessageBubble.tsx
│   │   ├── ModelPickerDropdown.tsx
│   │   ├── PromptSuggestions.tsx
│   │   ├── Sidebar.tsx
│   │   └── TensorChatBrandLockup.tsx
│   ├── constants/
│   │   ├── models.ts
│   │   └── theme.ts
│   ├── context/
│   │   ├── FileRagContext.tsx
│   │   ├── LlamaContext.ts
│   │   └── ThemeContext.tsx
│   ├── hooks/
│   │   ├── useEmbeddingModelAsset.ts
│   │   ├── useFileRag.ts
│   │   ├── useLlama.ts
│   │   └── useVoice.ts
│   ├── miniapps/
│   │   ├── harness.ts                # Retry loop + timeout management
│   │   ├── MiniAppChatView.tsx
│   │   ├── MiniAppFullscreen.tsx
│   │   ├── MiniAppHome.tsx
│   │   ├── MiniAppWebView.tsx        # Sandboxed WebView container
│   │   ├── DevTracePanel.tsx
│   │   ├── classifyError.ts
│   │   ├── errorFeedback.ts
│   │   ├── identity.ts
│   │   ├── llamaErrorCatalog.ts
│   │   ├── memory.ts                 # Durable agent notes
│   │   ├── pipelineCore.ts           # Validation pipeline
│   │   ├── storage.ts
│   │   ├── toolPipeline.ts
│   │   ├── types.ts
│   │   ├── verifyLoop.ts             # Post-write verification + auto-retry
│   │   ├── runtime/
│   │   │   ├── tc.ts                 # 12-primitive component runtime
│   │   │   └── theme.ts
│   │   └── validator/
│   │       ├── applyPatch.ts
│   │       ├── schema.ts             # Component registry + prop validation
│   │       ├── smokeTest.ts
│   │       ├── staticChecks.ts
│   │       ├── tcStub.ts
│   │       └── types.ts
│   ├── navigation/
│   │   └── AppNavigator.tsx
│   ├── screens/
│   │   ├── ChatScreen.tsx
│   │   ├── FileVaultScreen.tsx
│   │   └── ModelCatalogScreen.tsx
│   ├── types/
│   │   ├── fileRag.ts
│   │   ├── webSearch.ts
│   │   └── react-native-enriched-markdown.d.ts
│   └── utils/
│       ├── bootTrace.ts
│       ├── fileReaders.ts
│       ├── kokoroPhonemizer.native.ts
│       ├── kokoroPhonemizer.ts
│       ├── kokoroTokenizer.ts
│       ├── loadableModels.ts
│       ├── markdownLatex.ts
│       ├── modelDownloadManager.ts
│       ├── modelMemory.ts
│       ├── optionalRequire.ts
│       ├── reasoning.ts
│       ├── translationLanguage.ts
│       ├── ttsText.ts
│       └── webSearch.ts
├── packages/
│   ├── react-native-sherpa-voice/
│   ├── react-native-phonemis/
│   └── react-native-document-ocr/
├── scripts/
│   ├── test-think-parser.js
│   ├── test-kokoro-phonemizer.js
│   ├── test-miniapp-local.ts
│   ├── test-miniapp-e2e.ts
│   └── ...
├── plugins/
│   └── with-ios-launch-storyboard-cache-bust/
└── web/                              # Separate Vite + React marketing site
```

Do not reintroduce removed legacy settings screens unless explicitly requested.

---

## Non-Negotiable Constraints

1. No cloud inference by default.
2. No Expo Router introduction unless explicitly requested.
3. Keep a single `useLlama()` instance at app root (`App.tsx`) and consume via `LlamaContext`.
4. Preserve dynamic `require(...)` guards for native-only modules in files that may evaluate in web/non-native contexts:
   - `llama.rn`
   - `react-native-sherpa-voice`
   - `onnxruntime-react-native`
   - `react-native-audio-api`
   - `react-native-zip-archive`
5. Model catalog changes must flow through `buildModels()` / `ModelConfig` in `src/constants/models.ts`.
6. Keep model artifacts in app document storage (`.../models/`) with integrity checks before load.
7. Respect portrait-only + automatic system appearance policy from `app.json`.
8. Mini-app component registry (`validator/schema.ts`) must stay in sync with `runtime/tc.ts` and `miniAppPromptText.ts` — edit all three together.
9. Mini-app WebView must remain fully sandboxed: no network, no file access beyond app directory, CSP enforced.

---

## Architecture Patterns You Must Preserve

### 1) Root context injection

- Instantiate `useLlama()` once in `App.tsx`.
- Provide via `LlamaContext.Provider`.
- Never create additional `useLlama()` instances in screens/components.

### 2) Streaming update pattern (hot path)

When streaming tokens, update the existing assistant message in place (by id), rather than appending a new message per token.

Why: avoids excessive allocations/re-renders and keeps scroll behavior stable.

### 3) Prompt construction and thinking tags

- Text chat uses Qwen sentinel format: `<|im_start|>` / `<|im_end|>`.
- Gemma 4 E2B uses native reasoning tokens (`nativeReasoning: true`) — do NOT inject `chat_template_kwargs: { enable_thinking }` for these models.
- Keep sentinel tokens intact when modifying prompt logic.
- Strip assistant `<think>...</think>` from prior turns before re-feeding history.

### 4) Vision path

- Use structured `messages` input for image prompts.
- Keep mmproj initialization + lazy fallback logic in `useLlama`.
- Fail clearly when image input is present but multimodal init is unavailable.

### 5) Voice runtime path

- `useVoice` owns download/extract/load orchestration, recording/playback, and backend selection.
- `packages/react-native-sherpa-voice` owns Whisper STT and Piper TTS native execution.
- Kokoro TTS stays on direct `onnxruntime-react-native` in the hook.
- Voice downloads rely on `react-native-fs` + `react-native-zip-archive` extraction path.
- Keep path derivation dynamic from current document directory (avoid stale cached container paths).

### 6) Persistence behavior

- Chats + active chat id are persisted in AsyncStorage.
- Chat writes are debounced in `ChatScreen`.
- App startup attempts auto-load of previously selected valid model in `App.tsx`.
- Mini-apps are persisted to disk (program.js + meta.json) with an AsyncStorage index.

### 7) Design token policy

- Use `src/constants/theme.ts` for shared tokens.
- Avoid hardcoding new one-off visual constants unless necessary.
- Before adding or restyling UI, inspect adjacent or equivalent components first and match their badge treatment, spacing, and layout patterns unless you are intentionally making a shared design-system change.

### 8) Agent / tool-calling pattern

- The `Agent` class implements a ReAct loop: generate -> check tool calls -> execute -> re-generate.
- `agentGenerate()` in `llamaAdapter.ts` bridges Agent to `useLlama.generateResponse()`.
- For `alwaysThinks` models: tool definitions go in the system prompt (not llama.rn grammar) to avoid token conflicts.
- For `nativeReasoning` models (Gemma 4): skip `chat_template_kwargs` injection — their templates don't expect it.
- Thinking is always disabled when tools are present (no reasoning budget during tool planning).
- Mini-app mode disables direct-search fallback and chat-mode prompt suffixes.

### 9) Mini-app builder pattern

- The harness (`miniapps/harness.ts`) wraps `Agent.run()` with timeouts, retries, and compaction.
- Each attempt creates a fresh `Agent` instance — no state carried between attempts.
- The 8-step validation pipeline (`pipelineCore.ts`) validates before writing to disk.
- Post-write verification window (2.5s) + auto-retry for runtime errors.
- Compaction levels 0-3 progressively shrink the system prompt to free output budget.
- Model's `nativeReasoning` flag must be threaded through `HarnessOptions` to the Agent constructor.

### 10) File RAG pattern

- `useFileRag` owns document ingestion, chunking, embedding, and vector search.
- `FileRagContext` provides RAG capabilities throughout the app.
- EmbeddingGemma model lifecycle managed by `useEmbeddingModelAsset`.
- Vector storage uses op-sqlite with SQLiteVec extension.
- Per-chat source management with enable/disable toggles.

---

## Skill Routing Matrix (Project-Relevant)

Use these skills when work matches the trigger. Prefer the minimum set that fully covers the task.

| Task type | Required skill(s) |
|---|---|
| LLM lifecycle, prompting, streaming, multimodal, llama native config | `tensorchat-llama-rn` |
| Voice STT/TTS/runtime/download/extraction flow | `vercel-react-native-skills` + `native-data-fetching` |
| Any network/download/fetch behavior | `native-data-fetching` |
| RN UI structure, interaction, animation, native UX details | `building-native-ui` + `vercel-react-native-skills` |
| Visual redesign/polish audits | `design-taste-frontend` or `redesign-existing-projects` |
| Expo CI/CD workflows | `expo-cicd-workflows` |
| Build/submission/deployment | `expo-deployment`, `expo-dev-client` |
| Expo SDK upgrade work | `upgrading-expo` |
| Browser automation/debugging flows | `playwright` |
| Finding/installing additional skills | `find-skills` |

### Skill conflict precedence

If skill guidance conflicts with repo constraints:

1. System/developer/user instructions
2. This `CLAUDE.md`
3. Skill defaults

Example: some generic Expo UI skills prefer Expo Router patterns; TensorChat uses React Navigation and should keep it unless explicitly asked otherwise.

---

## Performance and Efficiency Rules

### Runtime performance (app code)

1. Keep token-stream callbacks lightweight (no heavy parsing/serialization in per-token path).
2. Preserve stable refs/callbacks for hot chat interactions (`useRef`, `useCallback` patterns).
3. Keep scroll-follow behavior frame-scheduled (`requestAnimationFrame`) where already used.
4. Prefer animating `transform`/`opacity`; avoid introducing layout-thrashing animation on hot surfaces.
5. Avoid unnecessary re-renders in message lists and streaming UI paths.

### Agent execution efficiency (instruction/perf)

1. Use targeted reads and searches first (`rg`, `rg --files`, focused `sed` ranges).
2. Avoid broad whole-repo reads when a narrow scan can resolve the question.
3. Parallelize independent read/check commands when possible.
4. Update only files required by task scope.

---

## Development Workflow

### Setup

```bash
npm install
npx pod-install ios
```

### Run

```bash
npm start
npm run ios
npm run android
npm run web
```

Notes:
- Native AI features require native runtime/dev client; Expo Go is not sufficient for TensorChat inference paths.
- Web builds may run UI but not full native inference/runtime features.

### Rebuild native when

- Native dependencies/plugins change (`package.json`, `app.json` plugins)
- iOS/Android native project changes are made

---

## Read-First Map (Before Editing)

| Before changing... | Read first |
|---|---|
| LLM load/unload/generation/multimodal | `src/hooks/useLlama.ts`, `src/context/LlamaContext.ts` |
| Prompting/streaming/chat UX | `src/screens/ChatScreen.tsx`, `src/components/MessageBubble.tsx` |
| Voice behavior | `src/hooks/useVoice.ts`, `packages/react-native-sherpa-voice`, `src/components/ChatInput.tsx` |
| Model catalog/download/integrity/load UX | `src/screens/ModelCatalogScreen.tsx`, `src/constants/models.ts`, `App.tsx` |
| Tokens/theming | `src/constants/theme.ts` |
| Navigation entry | `src/navigation/AppNavigator.tsx` |
| Runtime/build config | `app.json`, `package.json` |
| Agent/tool calling | `src/agent/Agent.ts`, `src/agent/llamaAdapter.ts`, `src/agent/types.ts` |
| Mini-app builder | `src/agent/miniAppAgent.ts`, `src/agent/miniAppPromptText.ts`, `src/miniapps/harness.ts` |
| Mini-app runtime / components | `src/miniapps/runtime/tc.ts`, `src/miniapps/validator/schema.ts` |
| Mini-app storage/persistence | `src/miniapps/storage.ts`, `src/miniapps/types.ts` |
| Mini-app validation pipeline | `src/miniapps/pipelineCore.ts`, `src/miniapps/validator/` |
| File Vault / RAG | `src/hooks/useFileRag.ts`, `src/context/FileRagContext.tsx`, `src/screens/FileVaultScreen.tsx` |
| Web search tool | `src/agent/tools/webSearch.ts`, `src/utils/webSearch.ts` |

---

## Strict Verification Gate (Required)

After code changes, run:

```bash
npx tsc --noEmit
```

When touching thinking/streaming/parser logic, also run:

```bash
npm run test:think-parser
```

When touching mini-app builder, also run:

```bash
npm run test:miniapp
```

When editing `CLAUDE.md`, run consistency checks:

```bash
# Must return no stale matches outside this verification section
! sed '/^## Strict Verification Gate/,$d' CLAUDE.md | rg -n "SettingsScreen|com\.tensorchat\.app|Q5_K_M|Q6_K"

# Must confirm current architecture terms are present
rg -n "ModelCatalogScreen|useVoice|react-native-sherpa-voice|io\.tensorpath\.chat|Q3_K_M|Q4_K_M|Q8_0|buildModels|miniAppAgent|harness|FileRagContext|useFileRag" CLAUDE.md
```

If a required command fails, fix issues before finishing.

---

## TypeScript Rules

- Do not leave avoidable `any` casts.
- Prefer extending local interfaces for third-party callback gaps.
- Keep return types explicit for shared hooks/interfaces.
