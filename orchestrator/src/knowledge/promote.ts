import type { Capture } from "./capture-store.js";

export interface PromoteDeps {
  promoteCapture: (id: string) => Promise<Capture | null>;
  enrich?: (raw: string) => Promise<{ summary: string; tags: string[] }>;
}

export interface PromoteResult {
  capture: Capture;
  enriched?: { summary: string; tags: string[] };
}

export async function promote(id: string, deps: PromoteDeps): Promise<PromoteResult | null> {
  const capture = await deps.promoteCapture(id);
  if (capture === null) return null;

  if (deps.enrich === undefined) {
    return { capture };
  }

  const enriched = await deps.enrich(capture.raw);
  return { capture, enriched };
}
