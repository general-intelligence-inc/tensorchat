export type RagSourceType = 'pdf' | 'txt' | 'md' | 'html';

export interface RagSource {
  id: string;
  hash: string;
  name: string;
  type: RagSourceType;
  size: number | null;
  chunkCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface RagChunkMetadata extends Record<string, unknown> {
  sourceId: string;
  sourceName: string;
  sourceType: RagSourceType;
  hash: string;
  chunkIndex: number;
  chunkCount: number;
}

export interface PickedDocumentSource {
  uri: string;
  name: string;
  size: number | null;
  mimeType?: string | null;
}

export interface IndexedSourceResult {
  source: RagSource;
  alreadyIndexed: boolean;
}

export interface RagQueryResult {
  id: string;
  document?: string;
  embedding?: number[];
  metadata?: Record<string, unknown>;
  similarity?: number;
}