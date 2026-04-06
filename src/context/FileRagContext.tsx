import React, { createContext, useContext } from 'react';
import { useFileRag, type UseFileRagReturn } from '../hooks/useFileRag';

const defaultContext: UseFileRagReturn = {
  sources: [],
  isHydrated: false,
  isEmbeddingModelEnabled: true,
  isEmbeddingModelDownloaded: false,
  isBusy: false,
  isPreparingStore: false,
  embeddingDownloadProgress: null,
  indexingSourceName: null,
  statusMessage: null,
  error: null,
  clearError: () => {},
  downloadEmbeddingModel: async () => {},
  deleteEmbeddingModel: async () => {},
  disableEmbeddingModel: async () => {},
  enableEmbeddingModel: async () => {},
  indexDocument: async () => {
    throw new Error('File RAG is not available.');
  },
  deleteSource: async () => {},
  renameSource: async () => {},
  querySources: async () => [],
};

const FileRagContext = createContext<UseFileRagReturn>(defaultContext);

export function FileRagProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const value = useFileRag();
  return (
    <FileRagContext.Provider value={value}>{children}</FileRagContext.Provider>
  );
}

export function useFileRagContext(): UseFileRagReturn {
  return useContext(FileRagContext);
}