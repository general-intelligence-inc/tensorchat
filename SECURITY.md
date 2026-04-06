# Security Policy

## Reporting a vulnerability

**Please do not file security vulnerabilities as public GitHub issues.**

Use GitHub's [Private Vulnerability Reporting](https://github.com/general-intelligence-inc/tensorchat/security/advisories/new) to disclose security issues privately. This creates a confidential advisory visible only to the maintainers.

When reporting, please include:

- A description of the vulnerability and the potential impact
- Steps to reproduce, ideally with a minimal proof-of-concept
- The affected app version and platform (iOS/Android)
- Any suggested mitigation, if you have one

## Scope

**In scope:**

- The TensorChat app (`src/`, `App.tsx`, `index.ts`)
- The first-party packages under `packages/` (`react-native-sherpa-voice`, `react-native-phonemis`, `react-native-document-ocr`)
- Build and CI configuration in this repo

**Out of scope:**

- Vulnerabilities in upstream dependencies (`llama.rn`, `onnxruntime-react-native`, `react-native`, Expo, etc.) — please report those to their respective maintainers
- Issues in downloaded model weights
- Social engineering, physical attacks, or issues requiring a compromised device

## Response

We're a small team, so we can't promise specific SLAs, but we aim to acknowledge reports within a few business days and keep you updated as we investigate. We do not currently offer a bug bounty.

## Safe harbor

We will not pursue legal action against researchers who:

- Act in good faith
- Avoid privacy violations, data destruction, or service disruption
- Give us reasonable time to fix issues before public disclosure
- Follow this policy

Thank you for helping keep TensorChat and its users safe.
