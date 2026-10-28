import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { ArtifactStore } from "../artifacts/store.js";

export interface ArtifactDecisionRecord {
  by: "human";
  via: string;
  who?: string;
  at: number;
  decision: "approved" | "rejected";
}

export async function recordArtifactDecision(
  store: ArtifactStore,
  auditPath: string,
  input: {
    id: string;
    decision: "approved" | "rejected";
    via: string;
    who?: string;
    projectId?: string;
    now?: () => number;
  },
): Promise<ArtifactDecisionRecord> {
  const artifact = await store.read(input.id);
  const record: ArtifactDecisionRecord = {
    by: "human",
    via: input.via,
    ...(input.who ? { who: input.who } : {}),
    at: (input.now ?? Date.now)(),
    decision: input.decision,
  };
  await store.patchMeta(input.id, { decidedBy: record });
  try {
    await mkdir(dirname(auditPath), { recursive: true });
    await appendFile(auditPath, JSON.stringify({
      at: record.at,
      kind: artifact.kind,
      id: input.id,
      decision: record.decision,
      by: record.by,
      via: record.via,
      ...(record.who ? { who: record.who } : {}),
      ...(input.projectId ? { projectId: input.projectId } : {}),
    }) + "\n");
  } catch (error) {
    console.warn(`[decision-audit] 追加裁决审计失败（${input.id}）：`, error);
  }
  return record;
}
