import type { Capture as StoreCapture } from "./capture-store.js";
import { retrieveCaptures } from "./retrieve.js";
import type { Capture as RetrieveCapture, RetrieveHit } from "./retrieve.js";

export interface RecallDeps {
  listCaptures: () => Promise<StoreCapture[]>;
}

export async function recall(query: string, deps: RecallDeps, opts?: { limit?: number }): Promise<RetrieveHit[]> {
  const all = await deps.listCaptures();

  if (query.trim() === "" || all.length === 0) {
    return [];
  }

  const captures: RetrieveCapture[] = all.map((capture) => ({
    id: capture.id,
    source: String(capture.citedFrom ?? capture.source),
    text: capture.raw,
    tags: [...capture.tags],
    title: capture.summary,
  }));

  return retrieveCaptures(query, captures, opts);
}
