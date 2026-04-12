#!/usr/bin/env bash
#
# Start a local llama-server instance backed by the Gemma 4 E2B
# Q4_K_M gguf for the mini-app e2e test harness.
#
# The test harness (scripts/test-miniapp-e2e.ts) hits this server at
# 127.0.0.1:18080 with the production system prompt + tool schema and
# pipes the model's tool call through the validator pipeline. That
# lets us iterate on the mini-app agent against REAL llama inference
# without needing the simulator.
#
# Usage:
#   bash scripts/start-llama-server.sh          # foreground
#   bash scripts/start-llama-server.sh &        # background
#
# The gguf is sourced from the iOS simulator's TensorChat sandbox.
# If you're on a different setup, set GEMMA_GGUF_PATH env var.

set -euo pipefail

DEFAULT_GGUF="/Users/zhiye/Library/Developer/CoreSimulator/Devices/BAE7EC17-AC29-4F1B-B194-4DE1B0665FAF/data/Containers/Data/Application/1CF225BB-BC1C-4888-9BF5-0E67B265D601/Documents/models/gemma-4-E2B-it-Q4_K_M.gguf"
GGUF="${GEMMA_GGUF_PATH:-$DEFAULT_GGUF}"

if [ ! -f "$GGUF" ]; then
  echo "error: gguf not found at $GGUF"
  echo "set GEMMA_GGUF_PATH to point at a valid Gemma 4 E2B gguf"
  exit 1
fi

if ! command -v llama-server >/dev/null 2>&1; then
  echo "error: llama-server not in PATH. Install via: brew install llama.cpp"
  exit 1
fi

echo "starting llama-server on 127.0.0.1:18080 with $(basename "$GGUF")"
exec llama-server \
  --model "$GGUF" \
  --ctx-size 16384 \
  --n-predict 3072 \
  --jinja \
  --port 18080 \
  --host 127.0.0.1
