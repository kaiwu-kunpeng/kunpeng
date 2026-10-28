/** 疑似逃逸（suspected）：本仓习惯 fix-forward 而非 revert，只数 revert 的逃逸率（0.1%）会失真。
 *  确定性规则：流 A 合并后 N 天内，有后续合并的流 B 改了 A 改过的同一产品源码文件，且 B 的需求标题带修复类字样
 *  → A 记一次疑似逃逸。只是信号、不是定论，报告里与显式 revert 分两列。 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const SUSPECTED_ESCAPE_WINDOW_DAYS = 7;
const DAY_MS = 86_400_000;
const FIX_PATTERN = /\b(?:fix(?:es|ed)?|hotfix|regression|bug)\b|修复|修正|回归|返工/i;

export interface MergedFlowChange {
  flowId: string;
  mergedAt: number;
  files: string[];
  title: string;
}

export interface SuspectedEscape {
  flowId: string;
  laterFlowId: string;
  files: string[];
}

export function isProductSource(file: string): boolean {
  return /(^|\/)src\/.+\.[cm]?[jt]sx?$/.test(file) && !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file);
}

/** 需求的标题行：第一个非空行，去掉 markdown 标题井号。只看标题，免得背景段里的「修复」字样误报。 */
export function titleOf(requirement: string): string {
  const line = requirement.split(/\r?\n/).find((l) => l.trim() !== "") ?? "";
  return line.replace(/^#+\s*/, "").trim();
}

export function computeSuspectedEscapes(
  changes: readonly MergedFlowChange[],
  windowDays = SUSPECTED_ESCAPE_WINDOW_DAYS,
): SuspectedEscape[] {
  const sorted = [...changes].sort((a, b) => a.mergedAt - b.mergedAt);
  const out: SuspectedEscape[] = [];
  for (const [i, a] of sorted.entries()) {
    const aFiles = new Set(a.files.filter(isProductSource));
    if (aFiles.size === 0) continue;
    for (const b of sorted.slice(i + 1)) {
      if (b.mergedAt - a.mergedAt > windowDays * DAY_MS) break;
      if (b.flowId === a.flowId || !FIX_PATTERN.test(b.title)) continue;
      const overlap = b.files.filter((f) => aFiles.has(f));
      if (overlap.length > 0) {
        out.push({ flowId: a.flowId, laterFlowId: b.flowId, files: overlap });
        break;
      }
    }
  }
  return out;
}

/** 从 git 取 sinceMs 以来 first-parent 上的 kp/ 流合并，及每次合并带进来的文件。 */
export async function gitMergedFlowChanges(
  repoRoot: string,
  opts: { ref?: string; sinceMs: number; titleFor: (flowId: string) => string | undefined },
): Promise<MergedFlowChange[]> {
  const ref = opts.ref ?? "main";
  const { stdout } = await execFileAsync(
    "git",
    ["log", "--merges", "--first-parent", `--since=${new Date(opts.sinceMs).toISOString()}`, "--format=%H|%ct|%s", ref],
    { cwd: repoRoot, maxBuffer: 16 * 1024 * 1024 },
  );
  const changes: MergedFlowChange[] = [];
  for (const line of stdout.split("\n")) {
    const match = /^([0-9a-f]{7,40})\|(\d+)\|Merge branch 'kp\/([^']+)'/.exec(line.trim());
    if (!match) continue;
    const [, sha, seconds, flowId] = match;
    const diff = await execFileAsync("git", ["diff", "--name-only", `${sha}^1`, sha!], { cwd: repoRoot, maxBuffer: 16 * 1024 * 1024 });
    changes.push({
      flowId: flowId!,
      mergedAt: Number(seconds) * 1000,
      files: diff.stdout.split("\n").map((f) => f.trim()).filter(Boolean),
      title: opts.titleFor(flowId!) ?? line.slice(line.indexOf("|", line.indexOf("|") + 1) + 1),
    });
  }
  return changes;
}

export function formatSuspectedEscapes(mergedCount: number, suspected: readonly SuspectedEscape[], windowDays = SUSPECTED_ESCAPE_WINDOW_DAYS): string {
  const rate = mergedCount > 0 ? (suspected.length / mergedCount) * 100 : 0;
  const lines = [
    `疑似逃逸（suspected，确定性规则：合并后 ${windowDays} 天内有修复类后续流改了同一源码文件）：${suspected.length} / ${mergedCount}（${rate.toFixed(1)}%）`,
  ];
  for (const s of suspected) lines.push(`- ${s.flowId} ← ${s.laterFlowId}（${s.files.slice(0, 3).join("、")}）`);
  return lines.join("\n");
}
