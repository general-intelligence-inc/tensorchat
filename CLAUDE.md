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

### Current model matrix

- Base models: `0.8B`, `2B`, `4B`
- Quantizations currently supported: `Q3_K_M`, `Q4_K_M`, `Q8_0`
- Vision models include `mmproj` sidecar handling
- Model metadata is generated via `buildModels()` in `src/constants/models.ts`

---

## Repository Structure (Current)

```
tensorchat/
├── App.tsx
├── app.json
├── package.json
├── skills-lock.json
├── src/
│   ├── components/
│   │   ├── ChatEmptyState.tsx
│   │   ├── ChatHeader.tsx
│   │   ├── ChatInput.tsx
│   │   ├── MessageBubble.tsx
│   │   ├── ModelPickerDropdown.tsx
│   │   ├── PromptSuggestions.tsx
│   │   └── Sidebar.tsx
│   ├── constants/
│   │   ├── models.ts
│   │   └── theme.ts
│   ├── context/
│   │   └── LlamaContext.ts
│   ├── hooks/
│   │   ├── useLlama.ts
│   │   └── useVoice.ts
│   ├── navigation/
│   │   └── AppNavigator.tsx
│   └── screens/
│       ├── ChatScreen.tsx
│       └── ModelCatalogScreen.tsx
└── scripts/
    └── test-think-parser.js
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

### 7) Design token policy

- Use `src/constants/theme.ts` for shared tokens.
- Avoid hardcoding new one-off visual constants unless necessary.
- Before adding or restyling UI, inspect adjacent or equivalent components first and match their badge treatment, spacing, and layout patterns unless you are intentionally making a shared design-system change.

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
2. This `AGENTS.md`
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

When editing `AGENTS.md`, run consistency checks:

```bash
# Must return no stale matches outside this verification section
! sed '/^## Strict Verification Gate/,$d' AGENTS.md | rg -n "SettingsScreen|com\.tensorchat\.app|UD-IQ2_M|Q5_K_M|Q6_K"

# Must confirm current architecture terms are present
rg -n "ModelCatalogScreen|useVoice|react-native-sherpa-voice|io\.tensorpath\.chat|Q3_K_M|Q4_K_M|Q8_0|buildModels" AGENTS.md
```

If a required command fails, fix issues before finishing.

---

## TypeScript Rules

- Do not leave avoidable `any` casts.
- Prefer extending local interfaces for third-party callback gaps.
- Keep return types explicit for shared hooks/interfaces.
