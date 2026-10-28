import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomic } from "../util/atomic-write.js";
import { renderChangeArchive, type ChangeRecord, type ChangeStage } from "./change-archive.js";

export interface DossierFlow {
  flowId: string;
  status: string;
  stage: string;
  updatedAt: number;
}

export interface DossierInput {
  projectName: string;
  flows: DossierFlow[];
  now: number;
}

export const DOSSIER_AUTO_START = "<!-- DOSSIER:AUTO:START (机器生成,勿手改;由 kunpeng dossier 刷新) -->";
export const DOSSIER_AUTO_END = "<!-- DOSSIER:AUTO:END -->";

function flowStatusToChangeStage(status: string): ChangeStage {
  if (status === "verified") return "archived";
  if (status === "running") return "proposed";
  return "applied";
}

/** 渲染机器区(被 START/END 标记包裹):当前状态统计 + 最近进行中/全部流索引。纯函数,不读盘。 */
export function renderAutoBlock(input: DossierInput): string {
  const f = input.flows;
  const verified = f.filter((x) => x.status === "verified").length;
  const rolledBack = f.filter((x) => x.status === "rolled-back").length;
  const running = f.filter((x) => x.status === "running").length;
  const finished = verified + rolledBack;
  const successRate = finished === 0 ? 100 : Math.round((verified / finished) * 100);
  const recent = [...f].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 10);
  const changeRecords: ChangeRecord[] = recent.map((x) => ({
    id: x.flowId,
    stage: flowStatusToChangeStage(x.status),
    summary: x.stage,
    at: x.updatedAt,
    flowId: x.flowId,
  }));
  const rows = recent.length === 0
    ? "_(暂无流记录)_"
    : ["| flowId | 状态 | 阶段 |", "|---|---|---|", ...recent.map((x) => `| ${x.flowId} | ${x.status} | ${x.stage} |`)].join("\n");
  return [
    DOSSIER_AUTO_START,
    "",
    "## 当前状态(自动)",
    "",
    `- 累计流: **${f.length}** ｜ verified: **${verified}** ｜ 回滚: **${rolledBack}** ｜ 运行中: **${running}** ｜ 成功率: **${successRate}%**`,
    "",
    "### 最近流索引(近 10 条)",
    "",
    rows,
    "",
    renderChangeArchive(changeRecords),
    "",
    DOSSIER_AUTO_END,
  ].join("\n");
}

/** 默认 PROJECT.md 骨架(首次生成):人写区占位 + 机器区。人写区今后由人维护,刷新只动机器区。 */
function skeleton(input: DossierInput): string {
  return [
    `# ${input.projectName} · 项目档案 (PROJECT.md)`,
    "",
    "> 单一事实源。人写区(北极星/目标/roadmap)请直接编辑;机器区由 `kunpeng dossier` 刷新,勿手改。",
    "",
    "## 北极星 / 目标",
    "",
    "_(待填:本项目最能捕捉客户价值的单一领先指标 + 当期目标)_",
    "",
    "## Roadmap",
    "",
    "**Now:** _(待填)_",
    "",
    "**Next:** _(待填)_",
    "",
    "**Later:** _(待填)_",
    "",
    "## 决策日志",
    "",
    "见 `docs/decisions/`(ADR)。",
    "",
    renderAutoBlock(input),
    "",
  ].join("\n");
}

/** upsert:existing 含标记块→只替换 START..END 之间为新机器区,人写区原样保留;existing 为空→输出骨架。幂等(同输入跑两次结果相同)。 */
export function upsertDossier(existing: string | null, input: DossierInput): string {
  if (!existing || !existing.includes(DOSSIER_AUTO_START)) {
    return skeleton(input);
  }
  const start = existing.indexOf(DOSSIER_AUTO_START);
  const endMarker = existing.indexOf(DOSSIER_AUTO_END);
  if (endMarker < 0) return skeleton(input);
  const before = existing.slice(0, start);
  const after = existing.slice(endMarker + DOSSIER_AUTO_END.length);
  return before + renderAutoBlock(input) + after;
}

export type DossierWritePlan = { write: true; next: string } | { write: false; reason: string };

export function planDossierWrite(existing: string | null, input: DossierInput): DossierWritePlan {
  if (existing === null) return { write: true, next: upsertDossier(null, input) };
  if (existing.trim() === "") return { write: false, reason: "文件存在但内容为空（疑似并发写入中），拒绝用骨架覆盖" };
  const start = existing.indexOf(DOSSIER_AUTO_START);
  const end = existing.indexOf(DOSSIER_AUTO_END);
  if (start < 0 || end < 0 || end < start) {
    return { write: false, reason: "缺少完整的机器区标记（DOSSIER:AUTO:START/END），拒绝覆盖人写内容" };
  }
  return { write: true, next: upsertDossier(existing, input) };
}

/** 仅当 repoRoot 已有 PROJECT.md(opt-in)时,用 input 刷新其机器区并写回;无 PROJECT.md→返回 false、绝不新建。
 *  内容无变化则不写(避免 churn)。读写异常一律吞掉返回 false(best-effort,绝不挡主流程)。 */
export async function refreshDossierIfPresent(repoRoot: string, input: DossierInput): Promise<boolean> {
  const path = join(repoRoot, "PROJECT.md");
  let existing: string;
  try {
    existing = await readFile(path, "utf8");
  } catch {
    return false; // 未 opt-in:无 PROJECT.md,不新建
  }
  try {
    const plan = planDossierWrite(existing, input);
    if (!plan.write) return false;
    if (plan.next !== existing) await writeFileAtomic(path, plan.next);
    return true;
  } catch {
    return false;
  }
}
