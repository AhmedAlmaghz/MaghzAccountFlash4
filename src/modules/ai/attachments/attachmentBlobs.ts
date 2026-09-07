/**
 * In-memory binary registry for chat attachments.
 *
 * The database keeps metadata + extracted text only (migration 0023); the
 * binary payload (downscaled image, audio bytes) lives here, keyed by the
 * attachment id. Anything not found is treated as EXPIRED — the chip still
 * renders from persisted meta, but nothing is re-sent to the provider.
 *
 * Module-level Map (same pattern as the tool-result cache): renderer-scoped,
 * no persistence, cleared on logout/company switch by the caller.
 */

interface BlobEntry {
  dataUrl: string;
  byteSize: number;
  storedAt: number;
}

const registry = new Map<string, BlobEntry>();

/** Cap total in-memory binaries (~64MB) — oldest evicted first. */
const REGISTRY_BYTE_CAP = 64 * 1024 * 1024;

function currentBytes(): number {
  let total = 0;
  for (const e of registry.values()) total += e.byteSize;
  return total;
}

export function putAttachmentBlob(id: string, dataUrl: string, byteSize: number): void {
  if (!id || !dataUrl) return;
  registry.set(id, { dataUrl, byteSize: Math.max(0, byteSize), storedAt: Date.now() });
  while (currentBytes() > REGISTRY_BYTE_CAP && registry.size > 1) {
    const oldest = registry.keys().next().value as string | undefined;
    if (!oldest || oldest === id) break;
    registry.delete(oldest);
  }
}

/** Live binary for the send path, or null when expired/evicted. */
export function getAttachmentBlob(id: string): string | null {
  return registry.get(id)?.dataUrl ?? null;
}

export function hasAttachmentBlob(id: string): boolean {
  return registry.has(id);
}

export function dropAttachmentBlob(id: string): void {
  registry.delete(id);
}

export function clearAttachmentBlobs(): void {
  registry.clear();
}

/** Test helper — current registry footprint. */
export function attachmentBlobStats(): { count: number; bytes: number } {
  return { count: registry.size, bytes: currentBytes() };
}
