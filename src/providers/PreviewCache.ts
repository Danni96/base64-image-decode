import { DecodedImageResult } from '../core/types';

const MAX_CACHE_ENTRIES = 50;
const previewCache = new Map<string, DecodedImageResult>();
let itemCounter = 0;

/**
 * Stores a decoded image result in an in-memory LRU cache (max 50 entries)
 * and returns a short unique identifier for command URI references.
 */
export function storePreviewItem(item: DecodedImageResult): string {
  // Reuse existing ID if the exact same dataUri is already cached
  for (const [existingId, existingItem] of previewCache.entries()) {
    if (existingItem.dataUri === item.dataUri) {
      previewCache.delete(existingId);
      previewCache.set(existingId, item);
      return existingId;
    }
  }

  const id = `img_${Date.now()}_${++itemCounter}`;

  if (previewCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = previewCache.keys().next().value;
    if (oldestKey !== undefined) {
      previewCache.delete(oldestKey);
    }
  }

  previewCache.set(id, item);
  return id;
}

/**
 * Retrieves a cached decoded image result by ID and refreshes its LRU position.
 */
export function getPreviewItem(id: string): DecodedImageResult | undefined {
  const item = previewCache.get(id);
  if (!item) {
    return undefined;
  }

  // Refresh LRU order
  previewCache.delete(id);
  previewCache.set(id, item);
  return item;
}

/**
 * Clears all cached preview items.
 */
export function clearPreviewCache(): void {
  previewCache.clear();
}
