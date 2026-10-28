import type { ArtifactStore } from "../artifacts/store.js";
import type { Artifact } from "../artifacts/types.js";
import type { FitnessDelta } from "../evolution/fitness.js";
import { describePrediction, type Prediction } from "../evolution/prediction.js";

export interface RuleChange { target: string; text: string; }
export interface ProposedChange extends RuleChange {
  source: string;  // source = 触发它的 experience id（per-change provenance）
  prediction?: Prediction;  // 可证伪预测：采纳满窗口后由核对器复核
}
export interface SkippedExperience { id: string; reason: string; }
export interface ProposalEvidence {
  holdoutPassK: number;
  costPerResolvedTask: number;
  baseline?: { holdoutPassK?: number; costPerResolvedTask?: number };
  measuredAt?: number;
  fitness?: FitnessDelta;  // 真适应度证据（净省工时↑∧非回归）；存在时为主信号，holdoutPassK 退后备
}
export interface Proposal {
  sourceExperiences: string[];
  changes: ProposedChange[];                                  // 仅 conventions 目标
  rejected: { change: ProposedChange; reason: string }[];     // 命中 core 的被拒
  skipped?: SkippedExperience[];
  evidence?: ProposalEvidence;
}

// 不可变核心：进化不得改写（C6 护栏①）。target 含 "core" 即拒。
const IMMUTABLE = /core/i;

/** 判定提案是否具备可用于 upgrade 自动应用的 holdout 证据。纯函数，无 I/O。 */
export function hasApplicableEvidence(ev: ProposalEvidence | undefined): boolean {
  if (ev === undefined) return false;
  // 真适应度优先（E0②）：有 fitness 证据时以「净省工时↑∧非回归」为准，合成 holdoutPassK 退为后备。
  if (ev.fitness !== undefined) return ev.fitness.improved;
  // —— 后备：旧合成 holdout 信号，逻辑保持原样 ——
  if (!Number.isFinite(ev.holdoutPassK)) return false;
  // 必须有正向可靠性且落在 0..1 域内：零/越界证据不得过闸（与「带证据方可自动改系统」叙事对齐）。
  if (ev.holdoutPassK <= 0 || ev.holdoutPassK > 1) return false;
  // 必须在 holdout 上真变强：严格大于基线，Δ>0 才可过闸。
  return ev.holdoutPassK > (ev.baseline?.holdoutPassK ?? 0);
}

/** 判定经验是否具备验真证据（C6）。纯函数，无 I/O。 */
export function experienceUnverifiedReason(exp: Pick<Artifact, "meta">): string | undefined {
  const meta = exp.meta ?? {};
  if (typeof meta.verifiedBy === "string" && meta.verifiedBy.trim()) return undefined;
  if (meta.outcome === "verified") {
    if (typeof meta.sourceFlow === "string" && meta.sourceFlow.trim()) return undefined;
    return "meta.outcome=verified 但缺 meta.sourceFlow，无法追溯到已验证流";
  }
  return "无验真证据：缺 meta.verifiedBy，且 meta.outcome≠verified（C6 经验入库前须验真）";
}

/** 从 experience 产物构建进化提案（纯函数、确定性、不应用）。
 *  extra：蒸馏链路另外产出的候选 ProposedChange，并入同一提案、复用同一 core 护栏；
 *  但 sourceExperiences 仍只来自 experiences（extra 自带 per-change source，不污染 provenance）。 */
export function buildProposal(experiences: Artifact[], extra?: ProposedChange[]): Proposal {
  const changes: ProposedChange[] = [];
  const rejected: Proposal["rejected"] = [];
  const skipped: SkippedExperience[] = [];
  const sourceExperiences: string[] = [];
  for (const exp of experiences) {
    const rc = exp.meta.proposedRuleChange as RuleChange | undefined;
    if (!rc || typeof rc.target !== "string" || typeof rc.text !== "string") continue;
    const reason = experienceUnverifiedReason(exp);
    if (reason) {
      skipped.push({ id: exp.id, reason });
      continue;
    }
    sourceExperiences.push(exp.id);
    const change: ProposedChange = { target: rc.target, text: rc.text, source: exp.id };
    if (IMMUTABLE.test(rc.target)) {
      rejected.push({ change, reason: "目标命中不可变核心(core)，进化不得改写(C6 护栏①)" });
    } else {
      changes.push(change);
    }
  }
  for (const change of extra ?? []) {
    if (IMMUTABLE.test(change.target)) {
      rejected.push({ change, reason: "目标命中不可变核心(core)，进化不得改写(C6 护栏①)" });
    } else {
      changes.push(change);
    }
  }
  return { sourceExperiences, changes, rejected, skipped };
}

/** 把提案写成产物（status=draft，等人工门 #2 批准+应用）。绝不直接改 conventions/core。 */
export async function persistProposal(store: ArtifactStore, id: string, proposal: Proposal): Promise<void> {
  const lines: string[] = ["# 进化提案（需人工批准后应用 — 人工门 #2）", ""];
  lines.push(`来源经验: ${proposal.sourceExperiences.join(", ") || "(无)"}`, "");
  const skills = proposal.changes.filter((c) => c.target === "skills");
  const otherChanges = proposal.changes.filter((c) => c.target !== "skills");
  lines.push("## 拟改（conventions）");
  lines.push(...(otherChanges.length
    ? otherChanges.map((c) => `- [${c.target}] ${c.text} （源 ${c.source}）\n  - 预测：${c.prediction ? describePrediction(c.prediction) : "⚠ 无预测（采纳后无法复核效果）"}`)
    : ["(无)"]));
  lines.push("", "## 拟固化技能（进仓库 skills/ 前须人工门 #2 确认 + 验真）");
  lines.push(...(skills.length ? skills.map((c) => `- [skills] ${c.text}（源 ${c.source}）`) : ["(无)"]));
  if (proposal.rejected.length) {
    lines.push("", "## 已拒（命中不可变核心）");
    lines.push(...proposal.rejected.map((r) => `- [${r.change.target}] ${r.change.text} — ${r.reason}`));
  }
  if (proposal.skipped?.length) {
    lines.push("", "## 跳过（无验真证据，C6）");
    lines.push(...proposal.skipped.map((s) => `- ${s.id} — ${s.reason}`));
  }
  lines.push("", "## 评测证据");
  if (proposal.evidence) {
    lines.push(`- holdoutPassK: ${proposal.evidence.holdoutPassK}`);
    lines.push(`- costPerResolvedTask: ${proposal.evidence.costPerResolvedTask}`);
    if (proposal.evidence.baseline) {
      if (proposal.evidence.baseline.holdoutPassK !== undefined) {
        lines.push(`- baseline.holdoutPassK: ${proposal.evidence.baseline.holdoutPassK}`);
      }
      if (proposal.evidence.baseline.costPerResolvedTask !== undefined) {
        lines.push(`- baseline.costPerResolvedTask: ${proposal.evidence.baseline.costPerResolvedTask}`);
      }
    }
    if (proposal.evidence.measuredAt !== undefined) {
      lines.push(`- measuredAt: ${proposal.evidence.measuredAt}`);
    }
  } else {
    lines.push("⚠ 无评测证据，upgrade 路径不可自动应用（需 eval-runner 回放 holdout 后回填）");
  }
  await store.write({ kind: "proposal", id, status: "draft", body: lines.join("\n"), meta: { proposal } });
}
