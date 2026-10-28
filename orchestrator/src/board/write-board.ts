// 跨端看板写盘：collectState → BoardInput → 写 .kunpeng/{BOARD.md, board.json}。
// 供 `kunpeng board` 命令、plan/run 结束、serve 定时 共用，让 BOARD 始终最新（#3 自动刷新）。
// best-effort：任何环节出错只静默跳过（绝不因写看板拖垮主流程）。
import { join, basename } from "node:path";
import { writeFile, mkdir } from "node:fs/promises";
import { ArtifactStore } from "../artifacts/store.js";
import { collectState } from "../server/state.js";
import { readProjectSelf } from "../project/registry.js";
import { refreshDossierIfPresent } from "../dossier/dossier.js";
import { FlowTracker } from "../runtime/flowstate.js";
import { renderBoardJson, renderBoardMarkdown, type BoardInput } from "./board-render.js";
import { resolveProjectStateDir } from "../project/state-resolve.js";

export interface BoardWriteResult { systemLight: string; activeFlows: number; plans: number; humanGates: number; passedLines: number; }

/** 把项目当前进度写成工具无关的 BOARD.md + board.json。project 不给则从 .kunpeng/project.json 取、缺省用目录名。 */
export async function writeBoard(
  repoRoot: string,
  now: number = Date.now(),
  project?: { id: string; name: string },
): Promise<BoardWriteResult | null> {
  try {
    const store = new ArtifactStore(join(repoRoot, ".kunpeng", "artifacts"));
    const state = await collectState(store, repoRoot);
    const self = project ?? (await readProjectSelf(repoRoot).catch(() => undefined));
    const input: BoardInput = {
      project: {
        id: self?.id ?? basename(repoRoot),
        name: self?.name ?? basename(repoRoot),
        repoPath: repoRoot,
      },
      systemLight: state.systemLight,
      activeFlows: state.running.map((f) => ({ flowId: f.flowId, stage: f.stage, requirement: f.requirement ?? "" })),
      plans: state.plans.map((p) => ({ id: p.id, status: p.status, merged: p.merged, desc: p.desc })),
      humanGates: state.humanGates.map((g) => ({ what: g.what, detail: g.detail })),
      blockers: state.blockers.map((b) => ({ flowId: b.flowId, reason: b.reason })),
      passedLines: state.code.passedLines,
    };
    const board = renderBoardJson(input, now);
    await mkdir(join(repoRoot, ".kunpeng"), { recursive: true });
    await writeFile(join(repoRoot, ".kunpeng", "BOARD.md"), renderBoardMarkdown(board), "utf8");
    await writeFile(join(repoRoot, ".kunpeng", "board.json"), JSON.stringify(board, null, 2), "utf8");
    // 顺带刷新 PROJECT.md 机器区(仅当该仓已有 PROJECT.md;best-effort,失败不影响看板)。
    try {
      const flows = await new FlowTracker(resolveProjectStateDir(repoRoot)).list();
      await refreshDossierIfPresent(repoRoot, {
        projectName: input.project.name,
        flows: flows.map((s) => ({ flowId: s.flowId, status: s.status, stage: s.stage, updatedAt: s.updatedAt })),
        now,
      });
    } catch { /* best-effort */ }
    return { systemLight: state.systemLight, activeFlows: input.activeFlows.length, plans: input.plans.length, humanGates: input.humanGates.length, passedLines: input.passedLines };
  } catch {
    return null; // best-effort：写看板失败绝不影响主流程
  }
}
