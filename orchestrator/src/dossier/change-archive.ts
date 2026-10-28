import type { SpecDelta } from "../spec/delta-spec.js";

export type ChangeStage = "proposed" | "applied" | "archived";

export interface ProposeChangeInput {
  id: string;
  summary: string;
  at: number;
  adr?: string;
  flowId?: string;
  delta?: SpecDelta;
}

export interface ChangeRecord extends ProposeChangeInput {
  stage: ChangeStage;
}

const allowedNextStage: Record<ChangeStage, ChangeStage | undefined> = {
  proposed: "applied",
  applied: "archived",
  archived: undefined,
};

export function proposeChange(input: ProposeChangeInput): ChangeRecord {
  return { ...input, stage: "proposed" };
}

export function advanceChange(record: ChangeRecord, toStage: ChangeStage, at: number): ChangeRecord {
  if (allowedNextStage[record.stage] !== toStage) {
    throw new Error(`cannot advance change from ${record.stage} to ${toStage}`);
  }

  return { ...record, stage: toStage, at };
}

export function renderChangeArchive(records: ChangeRecord[]): string {
  if (records.length === 0) {
    return "## 变更归档\n\n(暂无变更)";
  }

  const lines = records.map((record) => {
    const adr = record.adr ? ` · ADR:${record.adr}` : "";
    const flow = record.flowId ? ` · flow:${record.flowId}` : "";
    return `- [${record.stage}] ${record.id} · ${record.summary}${adr}${flow}`;
  });

  return ["## 变更归档", "", ...lines].join("\n");
}
