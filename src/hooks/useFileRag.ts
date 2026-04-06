import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import RNFS from 'react-native-fs';
import {
  EMBEDDING_MODEL,
  isLikelyCompleteModelFile,
} from '../constants/models';
import type {
  IndexedSourceResult,
  PickedDocumentSource,
  RagChunkMetadata,
  RagQueryResult,
  RagSource,
  RagSourceType,
} from '../types/fileRag';
import {
  normalizeSourceType,
  readDocumentText,
  SUPPORTED_DOCUMENT_LABEL_TEXT,
} from '../utils/fileReaders';
import { optionalRequire } from '../utils/optionalRequire';

interface EmbeddingContextLike {
  embedding(text: string): Promise<{ embedding: number[] }>;
  release(): Promise<void>;
}

interface EmbeddingsLike {
  load(): Promise<this>;
  unload(): Promise<void>;
  embed(text: string): Promise<number[]>;
}

interface GetResultLike {
  id: string;
  document?: string;
  embedding?: number[];
  metadata?: Record<string, unknown>;
}

interface QueryResultLike extends GetResultLike {
  similarity?: number;
}

interface VectorStoreLike {
  load(): Promise<this>;
  unload(): Promise<void>;
  add(params: {
    id?: string;
    document?: string;
    embedding?: number[];
    metadata?: Record<string, unknown>;
  }): Promise<string>;
  delete(params: {
    predicate: (value: GetResultLike) => boolean;
  }): Promise<void>;
  query(params: {
    queryText?: string;
    queryEmbedding?: number[];
    nResults?: number;
    predicate?: (value: QueryResultLike) => boolean;
  }): Promise<QueryResultLike[]>;
}

type InitLlamaFn = (params: {
  model: string;
  embedding?: boolean;
  n_ctx?: number;
  n_threads?: number;
}) => Promise<EmbeddingContextLike>;

type RecursiveCharacterTextSplitterCtor = new (params: {
  chunkSize: number;
  chunkOverlap: number;
}) => {
  splitText(text: string): Promise<string[]>;
};

type TextSplitterLike = {
  splitText(text: string): Promise<string[]>;
};

type OPSQLiteVectorStoreCtor = new (params: {
  name: string;
  embeddings: EmbeddingsLike;
}) => VectorStoreLike;

let initLlama: InitLlamaFn | null = null;
let RecursiveCharacterTextSplitterClass: RecursiveCharacterTextSplitterCtor | null =
  null;
let OPSQLiteVectorStoreClass: OPSQLiteVectorStoreCtor | null = null;

const llamaModule = optionalRequire<{ initLlama: InitLlamaFn }>(() => require('llama.rn'));

if (llamaModule) {
  initLlama = llamaModule.initLlama;
} else {
  console.warn('[FileRAG] llama.rn not available in this environment');
}

const ragModule = optionalRequire<{
  RecursiveCharacterTextSplitter: RecursiveCharacterTextSplitterCtor;
}>(() => require('react-native-rag'));
const opSQLiteModule = optionalRequire<{
  OPSQLiteVectorStore: OPSQLiteVectorStoreCtor;
}>(() => require('@react-native-rag/op-sqlite'));

if (ragModule && opSQLiteModule) {
  RecursiveCharacterTextSplitterClass = ragModule.RecursiveCharacterTextSplitter;
  OPSQLiteVectorStoreClass = opSQLiteModule.OPSQLiteVectorStore;
} else {
  console.warn('[FileRAG] react-native-rag storage modules not available in this environment');
}

const SOURCES_STORAGE_KEY = 'tensorchat_rag_sources_v1';
const EMBEDDING_MODEL_DISABLED_KEY = 'tensorchat_rag_embedding_disabled_v1';
const VECTOR_STORE_NAME = 'tensorchat_file_vault';
const TEXT_SPLITTER_CHUNK_SIZE = 800;
const TEXT_SPLITTER_CHUNK_OVERLAP = 120;
const EMBEDDING_MODEL_DISABLED_MESSAGE =
  'File Vault is disabled because the embedding model was removed. Download the embedding model from Model Catalog to re-enable it.';
const PDF_PAGE_SECTION_SPLIT_PATTERN = /\n{2}(?=\[Page \d+\]\n)/g;

function sortSources(sources: RagSource[]): RagSource[] {
  return [...sources].sort((left, right) => {
    if (right.updatedAt !== left.updatedAt) {
      return right.updatedAt - left.updatedAt;
    }
    return left.name.localeCompare(right.name);
  });
}

function normalizeNativeFilePath(uri: string): string {
  return uri.startsWith('file://') ? uri.slice(7) : uri;
}

function normalizeChunks(chunks: string[]): string[] {
  return chunks
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0);
}

function getPdfPageSections(text: string): string[] {
  const normalizedText = text.trim();
  if (!normalizedText.startsWith('[Page ')) {
    return [];
  }

  return normalizedText
    .split(PDF_PAGE_SECTION_SPLIT_PATTERN)
    .map((section) => section.trim())
    .filter((section) => section.length > 0);
}

async function splitSourceTextIntoChunks(
  splitter: TextSplitterLike,
  sourceText: string,
  sourceType: RagSourceType,
): Promise<{
  chunks: string[];
  pageAware: boolean;
  pageSectionCount: number | null;
}> {
  if (sourceType !== 'pdf') {
    return {
      chunks: normalizeChunks(await splitter.splitText(sourceText)),
      pageAware: false,
      pageSectionCount: null,
    };
  }

  const pageSections = getPdfPageSections(sourceText);
  if (pageSections.length <= 1) {
    return {
      chunks: normalizeChunks(await splitter.splitText(sourceText)),
      pageAware: false,
      pageSectionCount: pageSections.length || null,
    };
  }

  const chunkGroups = await Promise.all(
    pageSections.map((pageSection) => splitter.splitText(pageSection)),
  );

  return {
    chunks: normalizeChunks(chunkGroups.flat()),
    pageAware: true,
    pageSectionCount: pageSections.length,
  };
}

function getModelsDir(): string {
  if (!FileSystem.documentDirectory) {
    throw new Error('App document storage is not available in this environment.');
  }
  return `${FileSystem.documentDirectory}models/`;
}

function getEmbeddingModelPath(): string {
  return `${getModelsDir()}${EMBEDDING_MODEL.filename}`;
}

async function isEmbeddingModelDownloadedOnDisk(): Promise<boolean> {
  try {
    const info = await FileSystem.getInfoAsync(getEmbeddingModelPath());
    const actualBytes = info.exists ? ((info as { size?: number }).size ?? 0) : 0;
    return info.exists && isLikelyCompleteModelFile(EMBEDDING_MODEL, actualBytes);
  } catch {
    return false;
  }
}

async function ensureDir(path: string): Promise<void> {
  const info = await FileSystem.getInfoAsync(path);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(path, { intermediates: true });
  }
}

class LlamaEmbeddings implements EmbeddingsLike {
  private context: EmbeddingContextLike | null = null;
  private loadPromise: Promise<this> | null = null;

  constructor(private readonly modelPath: string) {}

  public async load(): Promise<this> {
    if (this.context) {
      return this;
    }

    if (this.loadPromise) {
      return this.loadPromise;
    }

    if (!initLlama) {
      throw new Error('llama.rn is not available on this platform.');
    }

    this.loadPromise = (async () => {
      this.context = await initLlama({
        model: this.modelPath,
        embedding: true,
        n_ctx: 512,
        n_threads: 2,
      });
      return this;
    })().finally(() => {
      this.loadPromise = null;
    });

    return this.loadPromise;
  }

  public async unload(): Promise<void> {
    if (!this.context) {
      return;
    }

    const currentContext = this.context;
    this.context = null;
    await currentContext.release();
  }

  public async embed(text: string): Promise<number[]> {
    await this.load();

    if (!this.context) {
      throw new Error('Embedding model is not loaded.');
    }

    const result = await this.context.embedding(text);
    return result.embedding;
  }
}

function isRagSource(value: unknown): value is RagSource {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const source = value as Partial<RagSource>;
  return (
    typeof source.id === 'string' &&
    typeof source.hash === 'string' &&
    typeof source.name === 'string' &&
    typeof source.type === 'string' &&
    (typeof source.size === 'number' || source.size === null) &&
    typeof source.chunkCount === 'number' &&
    typeof source.createdAt === 'number' &&
    typeof source.updatedAt === 'number'
  );
}

export interface UseFileRagReturn {
  sources: RagSource[];
  isHydrated: boolean;
  isEmbeddingModelEnabled: boolean;
  isEmbeddingModelDownloaded: boolean;
  isBusy: boolean;
  isPreparingStore: boolean;
  embeddingDownloadProgress: number | null;
  indexingSourceName: string | null;
  statusMessage: string | null;
  error: string | null;
  clearError: () => void;
  downloadEmbeddingModel: () => Promise<void>;
  deleteEmbeddingModel: () => Promise<void>;
  disableEmbeddingModel: () => Promise<void>;
  enableEmbeddingModel: () => Promise<void>;
  indexDocument: (picked: PickedDocumentSource) => Promise<IndexedSourceResult>;
  deleteSource: (sourceId: string) => Promise<void>;
  renameSource: (sourceId: string, nextName: string) => Promise<void>;
  querySources: (
    sourceIds: string[],
    queryText: string,
    options?: { nResults?: number },
  ) => Promise<RagQueryResult[]>;
}

export function useFileRag(): UseFileRagReturn {
  const [sources, setSources] = useState<RagSource[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);
  const [isEmbeddingModelEnabled, setIsEmbeddingModelEnabled] = useState(true);
  const [isEmbeddingModelDownloaded, setIsEmbeddingModelDownloaded] =
    useState(false);
  const [isPreparingStore, setIsPreparingStore] = useState(false);
  const [embeddingDownloadProgress, setEmbeddingDownloadProgress] = useState<
    number | null
  >(null);
  const [indexingSourceName, setIndexingSourceName] = useState<string | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const sourcesRef = useRef<RagSource[]>([]);
  const storeRef = useRef<VectorStoreLike | null>(null);
  const embeddingsRef = useRef<LlamaEmbeddings | null>(null);
  const storeLoadPromiseRef = useRef<Promise<VectorStoreLike> | null>(null);
  const embeddingDisabledRef = useRef(false);

  useEffect(() => {
    sourcesRef.current = sources;
  }, [sources]);

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      AsyncStorage.getItem(SOURCES_STORAGE_KEY),
      AsyncStorage.getItem(EMBEDDING_MODEL_DISABLED_KEY),
      isEmbeddingModelDownloadedOnDisk(),
    ])
      .then(([rawSources, rawEmbeddingDisabled, embeddingDownloaded]) => {
        if (cancelled) {
          return;
        }

        if (rawSources) {
          const parsed = JSON.parse(rawSources) as unknown;
          if (Array.isArray(parsed)) {
            const nextSources = parsed.filter(isRagSource);
            setSources(sortSources(nextSources));
          }
        }

        const embeddingDisabled = rawEmbeddingDisabled === '1';
        embeddingDisabledRef.current = embeddingDisabled;
        setIsEmbeddingModelEnabled(!embeddingDisabled);
        setIsEmbeddingModelDownloaded(embeddingDownloaded);
      })
      .catch((loadError) => {
        console.warn('[FileRAG] Failed to load File Vault state:', loadError);
      })
      .finally(() => {
        if (!cancelled) {
          setIsHydrated(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    AsyncStorage.setItem(SOURCES_STORAGE_KEY, JSON.stringify(sources)).catch(
      (persistError) => {
        console.warn('[FileRAG] Failed to persist source registry:', persistError);
      },
    );
  }, [isHydrated, sources]);

  useEffect(() => {
    return () => {
      const store = storeRef.current;
      storeRef.current = null;

      if (store) {
        void store.unload().catch((unloadError) => {
          console.warn('[FileRAG] Failed to unload vector store:', unloadError);
        });
        return;
      }

      if (embeddingsRef.current) {
        void embeddingsRef.current.unload().catch((unloadError) => {
          console.warn('[FileRAG] Failed to unload embedding model:', unloadError);
        });
      }
    };
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const refreshEmbeddingModelDownloaded = useCallback(async (): Promise<boolean> => {
    const downloaded = await isEmbeddingModelDownloadedOnDisk();
    setIsEmbeddingModelDownloaded(downloaded);
    return downloaded;
  }, []);

  const teardownEmbeddingRuntime = useCallback(async (): Promise<void> => {
    const store = storeRef.current;
    const embeddings = embeddingsRef.current;

    storeRef.current = null;
    embeddingsRef.current = null;
    storeLoadPromiseRef.current = null;

    setIsPreparingStore(false);
    setEmbeddingDownloadProgress(null);
    setIndexingSourceName(null);

    if (store) {
      await store.unload().catch((unloadError) => {
        console.warn('[FileRAG] Failed to unload vector store:', unloadError);
      });
    }

    if (embeddings) {
      await embeddings.unload().catch((unloadError) => {
        console.warn('[FileRAG] Failed to unload embedding model:', unloadError);
      });
    }
  }, []);

  const ensureEmbeddingModelEnabled = useCallback((): void => {
    if (!embeddingDisabledRef.current) {
      return;
    }

    setError(EMBEDDING_MODEL_DISABLED_MESSAGE);
    throw new Error(EMBEDDING_MODEL_DISABLED_MESSAGE);
  }, []);

  const disableEmbeddingModel = useCallback(async (): Promise<void> => {
    embeddingDisabledRef.current = true;
    setIsEmbeddingModelEnabled(false);
    setError(null);
    await AsyncStorage.setItem(EMBEDDING_MODEL_DISABLED_KEY, '1');
    await teardownEmbeddingRuntime();
  }, [teardownEmbeddingRuntime]);

  const enableEmbeddingModel = useCallback(async (): Promise<void> => {
    embeddingDisabledRef.current = false;
    setIsEmbeddingModelEnabled(true);
    setError(null);
    await AsyncStorage.removeItem(EMBEDDING_MODEL_DISABLED_KEY);
  }, []);

  const downloadEmbeddingModelFile = useCallback(async (): Promise<string> => {
    const modelsDir = getModelsDir();
    await ensureDir(modelsDir);

    const modelPath = getEmbeddingModelPath();
    setEmbeddingDownloadProgress(0);
    await FileSystem.deleteAsync(modelPath, { idempotent: true }).catch(() => {});

    try {
      const download = FileSystem.createDownloadResumable(
        EMBEDDING_MODEL.downloadUrl,
        modelPath,
        {
          sessionType: FileSystem.FileSystemSessionType.BACKGROUND,
        },
        (progress) => {
          const ratio =
            progress.totalBytesExpectedToWrite > 0
              ? progress.totalBytesWritten / progress.totalBytesExpectedToWrite
              : 0;
          setEmbeddingDownloadProgress(ratio);
        },
      );

      const result = await download.downloadAsync();
      if (!result || result.status !== 200) {
        throw new Error(
          `Embedding model download failed with status ${result?.status ?? 'unknown'}.`,
        );
      }

      const downloaded = await refreshEmbeddingModelDownloaded();
      if (!downloaded) {
        throw new Error('Embedding model download is incomplete.');
      }

      return modelPath;
    } catch (downloadError) {
      setIsEmbeddingModelDownloaded(false);
      await FileSystem.deleteAsync(modelPath, { idempotent: true }).catch(() => {});
      throw downloadError;
    } finally {
      setEmbeddingDownloadProgress(null);
    }
  }, [refreshEmbeddingModelDownloaded]);

  const downloadEmbeddingModel = useCallback(async (): Promise<void> => {
    setError(null);
    await downloadEmbeddingModelFile();
    await enableEmbeddingModel();
    setIsEmbeddingModelDownloaded(true);
  }, [downloadEmbeddingModelFile, enableEmbeddingModel]);

  const deleteEmbeddingModel = useCallback(async (): Promise<void> => {
    setError(null);
    await FileSystem.deleteAsync(getEmbeddingModelPath(), { idempotent: true }).catch(() => {});
    setIsEmbeddingModelDownloaded(false);
    await disableEmbeddingModel();
  }, [disableEmbeddingModel]);

  const ensureEmbeddingModelFile = useCallback(async (): Promise<string> => {
    ensureEmbeddingModelEnabled();

    const downloaded = await refreshEmbeddingModelDownloaded();
    if (downloaded) {
      return getEmbeddingModelPath();
    }

    return downloadEmbeddingModelFile();
  }, [downloadEmbeddingModelFile, refreshEmbeddingModelDownloaded]);

  const ensureVectorStoreReady = useCallback(async (): Promise<VectorStoreLike> => {
    if (storeRef.current) {
      return storeRef.current;
    }

    if (storeLoadPromiseRef.current) {
      return storeLoadPromiseRef.current;
    }

    ensureEmbeddingModelEnabled();

    if (!initLlama) {
      throw new Error('llama.rn is not available on this platform.');
    }

    if (!RecursiveCharacterTextSplitterClass || !OPSQLiteVectorStoreClass) {
      throw new Error('RAG vector store dependencies are not available.');
    }

    setIsPreparingStore(true);

    const loadPromise = (async () => {
      const modelPath = await ensureEmbeddingModelFile();
      const embeddings = new LlamaEmbeddings(modelPath);
      const store = new OPSQLiteVectorStoreClass({
        name: VECTOR_STORE_NAME,
        embeddings,
      });

      try {
        await store.load();

        if (embeddingDisabledRef.current) {
          await store.unload().catch(() => {});
          await embeddings.unload().catch(() => {});
          throw new Error(EMBEDDING_MODEL_DISABLED_MESSAGE);
        }

        embeddingsRef.current = embeddings;
        storeRef.current = store;
        return store;
      } catch (storeError) {
        await embeddings.unload().catch(() => {});
        throw storeError;
      }
    })();

    storeLoadPromiseRef.current = loadPromise;

    try {
      return await loadPromise;
    } finally {
      storeLoadPromiseRef.current = null;
      setIsPreparingStore(false);
    }
  }, [ensureEmbeddingModelFile]);

  const indexDocument = useCallback(
    async (picked: PickedDocumentSource): Promise<IndexedSourceResult> => {
      setError(null);
      ensureEmbeddingModelEnabled();

      const sourceType = normalizeSourceType(picked.name, picked.mimeType);
      if (!sourceType) {
        const unsupportedError = new Error(
          `Unsupported file type. Use ${SUPPORTED_DOCUMENT_LABEL_TEXT} files.`,
        );
        setError(unsupportedError.message);
        throw unsupportedError;
      }

      const pickedInfo = await FileSystem.getInfoAsync(picked.uri);
      const pickedSize = (pickedInfo as { size?: number }).size ?? picked.size ?? 0;
      if (!pickedInfo.exists || pickedSize <= 0) {
        const fileAccessError = new Error('The selected file is empty or unreachable.');
        setError(fileAccessError.message);
        throw fileAccessError;
      }

      const indexingStartedAt = Date.now();
      console.log('[FileRAG] indexing document:', {
        name: picked.name,
        type: sourceType,
        size: pickedSize,
        file: normalizeNativeFilePath(picked.uri).split('/').pop() ?? picked.name,
      });

      const hash = await RNFS.hash(normalizeNativeFilePath(picked.uri), 'sha256');
      const existingSource = sourcesRef.current.find((source) => source.hash === hash);
      if (existingSource) {
        console.log('[FileRAG] document already indexed:', {
          name: existingSource.name,
          sourceId: existingSource.id,
        });
        return { source: existingSource, alreadyIndexed: true };
      }

      setIndexingSourceName(picked.name);

      try {
        const documentReadStartedAt = Date.now();
        const sourceText = await readDocumentText(picked.uri, sourceType);
        const documentReadElapsedMs = Date.now() - documentReadStartedAt;
        if (sourceText.trim().length === 0) {
          throw new Error(
            sourceType === 'pdf'
              ? 'No extractable text was found in this PDF.'
              : 'The selected file is empty or unreadable.',
          );
        }

        const store = await ensureVectorStoreReady();
        if (!RecursiveCharacterTextSplitterClass) {
          throw new Error('Document splitter is not available.');
        }

        const splitter = new RecursiveCharacterTextSplitterClass({
          chunkSize: TEXT_SPLITTER_CHUNK_SIZE,
          chunkOverlap: TEXT_SPLITTER_CHUNK_OVERLAP,
        });
        const splitResult = await splitSourceTextIntoChunks(splitter, sourceText, sourceType);
        const chunks = splitResult.chunks;

        console.log('[FileRAG] extracted document text:', {
          name: picked.name,
          type: sourceType,
          characters: sourceText.length,
          chunkCount: chunks.length,
          chunkOverlap: TEXT_SPLITTER_CHUNK_OVERLAP,
          chunkSize: TEXT_SPLITTER_CHUNK_SIZE,
          pageAware: splitResult.pageAware,
          pageSectionCount: splitResult.pageSectionCount,
          readElapsedMs: documentReadElapsedMs,
        });

        if (chunks.length === 0) {
          throw new Error('The selected file did not produce any readable text chunks.');
        }

        const now = Date.now();
        const source: RagSource = {
          id: hash,
          hash,
          name: picked.name,
          type: sourceType,
          size: picked.size,
          chunkCount: chunks.length,
          createdAt: now,
          updatedAt: now,
        };

        try {
          for (let index = 0; index < chunks.length; index += 1) {
            const metadata: RagChunkMetadata = {
              sourceId: source.id,
              sourceName: source.name,
              sourceType: source.type,
              hash: source.hash,
              chunkIndex: index,
              chunkCount: chunks.length,
            };
            await store.add({ document: chunks[index], metadata });
          }
        } catch (storeError) {
          await store.delete({
            predicate: (value) => value.metadata?.sourceId === source.id,
          });
          throw storeError;
        }

        setSources((currentSources) => sortSources([source, ...currentSources]));
        console.log('[FileRAG] indexing completed:', {
          elapsedMs: Date.now() - indexingStartedAt,
          name: source.name,
          sourceId: source.id,
          chunkCount: source.chunkCount,
        });
        return { source, alreadyIndexed: false };
      } catch (indexError) {
        const message =
          indexError instanceof Error ? indexError.message : String(indexError);
        console.warn('[FileRAG] indexing failed:', {
          elapsedMs: Date.now() - indexingStartedAt,
          name: picked.name,
          type: sourceType,
          error: message,
        });
        setError(message);
        throw indexError;
      } finally {
        setIndexingSourceName(null);
      }
    },
    [ensureVectorStoreReady],
  );

  const deleteSource = useCallback(
    async (sourceId: string): Promise<void> => {
      setError(null);

      try {
        const store = await ensureVectorStoreReady();
        await store.delete({
          predicate: (value) => value.metadata?.sourceId === sourceId,
        });
        setSources((currentSources) =>
          currentSources.filter((source) => source.id !== sourceId),
        );
      } catch (deleteError) {
        const message =
          deleteError instanceof Error ? deleteError.message : String(deleteError);
        setError(message);
        throw deleteError;
      }
    },
    [ensureVectorStoreReady],
  );

  const renameSource = useCallback(
    async (sourceId: string, nextName: string): Promise<void> => {
      const trimmedName = nextName.trim();
      if (!trimmedName) {
        throw new Error('File name cannot be empty.');
      }

      setSources((currentSources) =>
        sortSources(
          currentSources.map((source) =>
            source.id === sourceId
              ? { ...source, name: trimmedName, updatedAt: Date.now() }
              : source,
          ),
        ),
      );
    },
    [],
  );

  const querySources = useCallback(
    async (
      sourceIds: string[],
      queryText: string,
      options?: { nResults?: number },
    ): Promise<RagQueryResult[]> => {
      const trimmedQuery = queryText.trim();
      if (sourceIds.length === 0 || trimmedQuery.length === 0) {
        return [];
      }

      const activeSourceIds = new Set(sourceIds);

      try {
        ensureEmbeddingModelEnabled();
        const store = await ensureVectorStoreReady();
        const results = await store.query({
          queryText: trimmedQuery,
          nResults: options?.nResults ?? 5,
          predicate: (value) => {
            const sourceId = value.metadata?.sourceId;
            return typeof sourceId === 'string' && activeSourceIds.has(sourceId);
          },
        });

        return results as RagQueryResult[];
      } catch (queryError) {
        const message =
          queryError instanceof Error ? queryError.message : String(queryError);
        setError(message);
        throw queryError;
      }
    },
    [ensureVectorStoreReady],
  );

  const isBusy =
    isPreparingStore ||
    embeddingDownloadProgress !== null ||
    indexingSourceName !== null;

  const statusMessage = useMemo(() => {
    if (embeddingDownloadProgress !== null) {
      return `Downloading embedding model ${Math.round(
        embeddingDownloadProgress * 100,
      )}%`;
    }

    if (indexingSourceName) {
      return `Indexing ${indexingSourceName}`;
    }

    if (isPreparingStore) {
      return 'Preparing on-device embeddings';
    }

    if (!isEmbeddingModelEnabled) {
      return EMBEDDING_MODEL_DISABLED_MESSAGE;
    }

    return null;
  }, [embeddingDownloadProgress, indexingSourceName, isEmbeddingModelEnabled, isPreparingStore]);

  return {
    sources,
    isHydrated,
    isEmbeddingModelEnabled,
    isEmbeddingModelDownloaded,
    isBusy,
    isPreparingStore,
    embeddingDownloadProgress,
    indexingSourceName,
    statusMessage,
    error,
    clearError,
    downloadEmbeddingModel,
    deleteEmbeddingModel,
    disableEmbeddingModel,
    enableEmbeddingModel,
    indexDocument,
    deleteSource,
    renameSource,
    querySources,
  };
}