import type { ProjectSnapshot } from "../server/state.js";

const MERGE_GATE_MS = 60 * 60_000;
const STUCK_MS = 30 * 60_000;

export function phonePushCandidates(snapshots: ProjectSnapshot[], now: number): Array<{ key: string; line: string }> {
  const out: Array<{ key: string; line: string }> = [];
  for (const snapshot of snapshots) {
    for (const flow of snapshot.state.flows ?? []) {
      if (flow.status !== "verified" || !flow.humanGate?.gate.includes("合并主干")) continue;
      const openedAt = flow.gateOpenedAt;
      if (typeof openedAt !== "number" || !Number.isFinite(openedAt)) continue;
      const waited = now - openedAt;
      if (waited < MERGE_GATE_MS) continue;
      out.push({ key: `merge:${snapshot.id}:${flow.flowId}`, line: `${flow.flowId} 合并门已等 ${Math.round(waited / 60_000)} 分钟` });
    }
    for (const alert of snapshot.state.health?.alerts ?? []) {
      if (alert.kind !== "stuck" || alert.ageMs < STUCK_MS) continue;
      out.push({ key: `stuck:${snapshot.id}:${alert.flowId}`, line: `${alert.flowId} 卡死 ${Math.round(alert.ageMs / 60_000)} 分钟` });
    }
  }
  return out;
}
