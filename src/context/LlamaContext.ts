import React, { createContext, useContext as useReactContext } from 'react';
import { UseLlamaReturn } from '../hooks/useLlama';

const defaultContext: UseLlamaReturn = {
  isLoading: false,
  isGenerating: false,
  loadedModelPath: null,
  loadedContextSize: null,
  multimodalEnabled: false,
  loadedMmprojPath: null,
  error: null,
  isTranslationLoading: false,
  isTranslationGenerating: false,
  loadedTranslationModelPath: null,
  translationError: null,
  loadModel: async () => false,
  unloadModel: async () => {},
  loadTranslationModel: async () => false,
  unloadTranslationModel: async () => {},
  generateResponse: async () => ({
    content: '',
    responseContent: '',
    reasoningContent: '',
    combinedContent: '',
    reasoningTokenCount: 0,
    toolCalls: [],
  }),
  generateTranslation: async () => ({
    content: '',
    responseContent: '',
    reasoningContent: '',
    combinedContent: '',
    reasoningTokenCount: 0,
    toolCalls: [],
  }),
  countPromptTokens: async () => null,
  stopGeneration: async () => {},
  stopTranslationGeneration: async () => {},
};

export const LlamaContext = createContext<UseLlamaReturn>(defaultContext);

export function useLlamaContext(): UseLlamaReturn {
  return useReactContext(LlamaContext);
}
