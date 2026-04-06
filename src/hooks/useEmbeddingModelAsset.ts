import { useCallback } from 'react';
import { Alert } from 'react-native';
import { EMBEDDING_MODEL } from '../constants/models';
import { useFileRagContext } from '../context/FileRagContext';

export interface UseEmbeddingModelAssetReturn {
  isDownloaded: boolean;
  isEnabled: boolean;
  downloadProgress: number | null;
  isBusy: boolean;
  download: () => Promise<void>;
  requestDelete: () => void;
}

export function useEmbeddingModelAsset(): UseEmbeddingModelAssetReturn {
  const {
    isEmbeddingModelDownloaded,
    isEmbeddingModelEnabled,
    embeddingDownloadProgress,
    isBusy,
    downloadEmbeddingModel,
    deleteEmbeddingModel,
  } = useFileRagContext();

  const download = useCallback(async (): Promise<void> => {
    if (embeddingDownloadProgress !== null) {
      return;
    }

    try {
      await downloadEmbeddingModel();
      Alert.alert('Download complete', `${EMBEDDING_MODEL.name} is ready to use.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      Alert.alert('Download failed', message);
    }
  }, [downloadEmbeddingModel, embeddingDownloadProgress]);

  const requestDelete = useCallback(() => {
    Alert.alert(
      'Delete embedding model',
      `Delete ${EMBEDDING_MODEL.name}? This will disable File Vault until you download the embedding model again.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void deleteEmbeddingModel().catch((err) => {
              const message = err instanceof Error ? err.message : String(err);
              Alert.alert('Error', message);
            });
          },
        },
      ],
    );
  }, [deleteEmbeddingModel]);

  return {
    isDownloaded: isEmbeddingModelDownloaded,
    isEnabled: isEmbeddingModelEnabled,
    downloadProgress: embeddingDownloadProgress,
    isBusy,
    download,
    requestDelete,
  };
}