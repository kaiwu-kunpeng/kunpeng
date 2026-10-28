import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import simpleGit from "simple-git";
import type { ArtifactStore, ArtifactSummary } from "../../artifacts/store.js";
import type { Artifact } from "../../artifacts/types.js";
import { countLinesFromRef } from "../../status/loc-ref.js";
import { relTime } from "../../util/rel-time.js";
import type { CodeMetrics, FlowWithLight, MainTruth, PlanSummary } from "../state-types.js";

/** LOC 缓存：避免每 2s tick 都遍历读文件（本地单用户，10s 足够新）。 */
const locCache = new Map<string, { at: number; src: number; test: number }>();

/** 递归数一个目录下所有 .ts/.tsx 文件的行数（缺失目录返回 0，不抛）。 */
async function countTsLines(dir: string): Promise<number> {
  let total = 0;
  const entries = await readdir(dir, { withFileTypes: true }).catch((): import("node:fs").Dirent[] => []);
  if (entries.length === 0) return 0;
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) total += await countTsLines(p);
    else if (e.name.endsWith(".ts") || e.name.endsWith(".tsx")) {
      try { total += (await readFile(p, "utf8")).split("\n").length; } catch { /* skip */ }
    }
  }
  return total;
}

/** 数 orchestrator/{src,test} 的代码行数，10s 缓存。 */
async function countSrcTest(repoRoot: string): Promise<{ src: number; test: number }> {
  const cached = locCache.get(repoRoot);
  if (cached && Date.now() - cached.at < 10000) return { src: cached.src, test: cached.test };
  let src: number;
  let test: number;
  // 治本：从 main ref 数（如实反映已合入 main 的代码＝passedLines 语义），
  // 不数工作树——否则工作树检在落后的 work 分支会让"过审行数"失真。出错/无匹配回退文件系统扫描。
  try {
    const git = simpleGit(repoRoot);
    src = await countLinesFromRef(git, "main", "orchestrator/src/*.ts");
    test = await countLinesFromRef(git, "main", "orchestrator/test/*.ts");
  } catch {
    src = 0;
    test = 0;
  }
  if (src === 0 && test === 0) {
    src = await countTsLines(join(repoRoot, "orchestrator", "src"));
    test = await countTsLines(join(repoRoot, "orchestrator", "test"));
  }
  if (src === 0 && test === 0) {
    for (const dir of ["src", "app", "components", "lib", "pages"]) {
      src += await countTsLines(join(repoRoot, dir));
    }
    for (const dir of ["test", "tests", "__tests__"]) {
      test += await countTsLines(join(repoRoot, dir));
    }
  }
  locCache.set(repoRoot, { at: Date.now(), src, test });
  return { src, test };
}

function planBodySummary(body: string, fallback: string): string {
  const summary = body
    .split("\n")
    .map((line) => line.trim().replace(/^[#>\s]+/, "").trim())
    .filter(Boolean)
    .slice(0, 3)
    .map((line) => line.slice(0, 100))
    .join(" · ");
  return summary || fallback;
}

export async function collectPlansCode({ repoRoot, store, arts, flows, now }: {
  repoRoot: string;
  store: ArtifactStore;
  arts: ArtifactSummary[];
  flows: FlowWithLight[];
  now: number;
}) {
  let git: ReturnType<typeof simpleGit> | undefined;
  let branches: string[] = [];
  try {
    git = simpleGit(repoRoot);
    branches = (await git.branchLocal()).all.filter((b) => b.startsWith("kp/"));
  } catch { /* not a repo */ }

  // 方案进度 + 整体计数（每个方案: 运行中/待合并/已合并/回滚；代码行数: 已过审 vs 在跑未合）。
  let mergedBranches: string[] = [];
  try { if (git) mergedBranches = (await git.branch(["--merged", "main"])).all; } catch { /* not a repo */ }
  let lastMergeAt: number | undefined;
  try {
    if (git) {
      const out = await git.raw(["log", "--merges", "-1", "--format=%ct", "main"]);
      const secs = parseInt(out.trim(), 10);
      if (Number.isFinite(secs) && secs > 0) lastMergeAt = secs * 1000;
    }
  } catch { /* 无 git / 无合并 -> 留空 */ }
  // gc 会删掉已合并的 kp/* 分支，故仅靠 branch --merged 会把已合并方案误判「待合并」。
  // 补：从 merge commit 历史认出已合并的集成分支（即便分支已被 gc 删）。
  let mergedFromLog = new Set<string>();
  try {
    // --first-parent + 显式 main：只认「并入 main 主线」的顶层 merge，排除 plan 内部段集成的嵌套 merge（否则 kp/段X 会被误判已合并）。
    if (git) {
      const log = await git.raw(["log", "main", "--first-parent", "--merges", "--format=%s", "-n", "2000"]);
      mergedFromLog = new Set([...log.matchAll(/Merge branch '(kp\/[^']+)'/g)].map((m) => m[1]));
    }
  } catch { /* 非 git 仓库 */ }
  let main: MainTruth | undefined;
  try {
    if (git) {
      const raw = await git.raw(["log", "-1", "main", "--format=%h%n%s%n%ct"]);
      const [commit, subject, committedAtText] = raw.trimEnd().split("\n");
      const committedAtMs = Number(committedAtText) * 1000;
      if (commit && subject && Number.isFinite(committedAtMs)) {
        main = {
          commit,
          subject,
          committedText: relTime(now - committedAtMs),
          mergedPlans: mergedFromLog.size,
          staleBranches: branches.length,
        };
      }
    }
  } catch { /* 非 git 仓库或无 main */ }
  const planArts = arts.filter((a) => a.kind === "plan");
  const planBodies = new Map(
    (await Promise.all(planArts.map(async (a) => {
      try {
        return [a.id, await store.read(a.id)] as const;
      } catch {
        return undefined;
      }
    }))).filter((item): item is readonly [string, Artifact] => item !== undefined),
  );
  const plans: PlanSummary[] = planArts.map((a) => {
    const body = planBodies.get(a.id)?.body;
    const descSource = body ?? a.summary;
    const desc = (descSource.split("\n").find((l) => l.trim()) ?? "").replace(/^#+\s*/, "").replace(/^[·•\s]+/, "").slice(0, 48);
    return {
      id: a.id,
      status: a.status,
      merged: a.status === "verified" && (mergedBranches.includes(`kp/${a.id}`) || mergedFromLog.has(`kp/${a.id}`)),
      desc,
      summary: body === undefined ? a.summary : planBodySummary(body, desc),
      segmentCount: flows.filter((f) => f.planId === a.id).length,
    };
  });
  const completed = plans.filter((p) => p.merged).length;
  const runningPlans = planArts.filter((a) => a.status === "in-progress").length;
  const rolledBack = planArts.filter((a) => a.status === "rolled-back").length;
  const { src: srcLines, test: testLines } = await countSrcTest(repoRoot);
  let inFlightLines = 0;
  for (const a of planArts.filter((a) => a.status === "in-progress")) {
    try {
      if (git) {
        const stat = await git.raw(["diff", "--shortstat", `main..kp/${a.id}`]);
        const m = stat.match(/(\d+) insertion/);
        if (m) inFlightLines += Number(m[1]);
      }
    } catch { /* 分支未建好等，忽略 */ }
  }
  const code: CodeMetrics = {
    srcLines, testLines, passedLines: srcLines + testLines, inFlightLines,
    completed, running: runningPlans, rolledBack,
  };

  return { branches, main, plans, code, lastMergeAt };
}
