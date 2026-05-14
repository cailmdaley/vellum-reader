import Fuse from 'fuse.js';
import type { IFuseOptions } from 'fuse.js';
import type { SearchDocument, SearchIndexPayload } from './types.js';

export const FUSE_OPTIONS: IFuseOptions<SearchDocument> = {
  includeScore: true,
  threshold: 0.36,
  ignoreLocation: true,
  minMatchCharLength: 2,
  keys: [
    { name: 'title', weight: 2.0 },
    { name: 'outcome', weight: 1.4 },
    { name: 'body', weight: 1.0 },
    { name: 'tags', weight: 0.6 },
    { name: 'id', weight: 0.2 },
  ],
};

export function buildSearchIndex(documents: SearchDocument[]): SearchIndexPayload {
  const index = Fuse.createIndex(FUSE_OPTIONS.keys ?? [], documents);
  return {
    documents,
    index: index.toJSON() as Record<string, any>,
  };
}
