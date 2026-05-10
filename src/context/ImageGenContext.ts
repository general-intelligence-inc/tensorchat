import { createContext, useContext as useReactContext } from "react";
import type { UseImageGenReturn } from "../hooks/useImageGen";

const defaultContext: UseImageGenReturn = {
  isEngineConfigured: false,
  isAvailable: false,
  isLoading: false,
  isGenerating: false,
  loadedModelId: null,
  error: null,
  progress: null,
  isModelDownloaded: async () => false,
  loadModel: async () => false,
  unloadModel: async () => {},
  generate: async () => null,
  cancel: async () => {},
};

export const ImageGenContext =
  createContext<UseImageGenReturn>(defaultContext);

export function useImageGenContext(): UseImageGenReturn {
  return useReactContext(ImageGenContext);
}
