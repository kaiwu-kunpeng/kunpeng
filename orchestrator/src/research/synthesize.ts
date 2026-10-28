import type { ResearchFinding } from "./types.js";
import type { ProposedChange } from "../loop/self-evolution.js";

/** 调研发现 → 进化提案（纯函数、确定性）。
 *  仅保留同时带 suggestedConvention 与 source 的 finding；
 *  target 恒为 "conventions"（绝不指向 core，对齐宪法 C6）；
 *  text/source 内嵌来源 URL，保证可追溯/验真（C2、C6）。 */
export function synthesizeProposals(findings: ResearchFinding[]): ProposedChange[] {
  const changes: ProposedChange[] = [];
  for (const f of findings) {
    if (f.suggestedConvention && f.source) {
      changes.push({
        target: "conventions",
        text: `据 ${f.source} 调研：${f.suggestedConvention}`,
        source: `research:${f.source}`,
        ...(f.prediction ? { prediction: f.prediction } : {}),
      });
    }
    if (f.suggestedUpgrade && f.source) {
      changes.push({
        target: "upgrade",
        text: `据 ${f.source} 建议升级：${f.suggestedUpgrade}`,
        source: `research:${f.source}`,
        ...(f.prediction ? { prediction: f.prediction } : {}),
      });
    }
  }
  return changes;
}
