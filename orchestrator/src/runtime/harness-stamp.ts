import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

export interface HarnessStamp {
  gitSha: string | null;
  dirty: boolean | null;
  gateHash: string;
  at: number;
}

export const HARNESS_GATE_FILES: readonly string[] = [
  "src/verify/gate.ts",
  "src/verify/scope-gate.ts",
  "src/verify/scope-main-gate.ts",
  "src/verify/red-first.ts",
  "src/verify/eval-asset-guard.ts",
  "src/runtime/merge-gate.ts",
  "src/runtime/merge-review.ts",
  "src/runtime/merge-guard-tests.ts",
  "src/runtime/sensitive-paths.ts",
  "src/runtime/sensitive-branch.ts",
  "src/loop/dev-cycle.ts",
  "src/loop/audit.ts",
  "src/loop/guardian.ts",
  "src/plan/spec-lint.ts",
];

export type HarnessGitRunner = (args: string[], cwd: string) => Promise<string>;

const execFileAsync = promisify(execFile);
const defaultGit: HarnessGitRunner = async (args, cwd) => {
  const { stdout } = await execFileAsync("git", args, { cwd, timeout: 10_000 });
  return stdout;
};

/** 采集失败只降级印章字段，不影响被记录的流。 */
export async function computeHarnessStamp(
  orchestratorRoot: string,
  opts?: { git?: HarnessGitRunner; now?: () => number },
): Promise<HarnessStamp> {
  const hash = createHash("sha256");
  for (const file of HARNESS_GATE_FILES) {
    let content: Buffer | string;
    try {
      content = await readFile(join(orchestratorRoot, file));
    } catch {
      // 缺失或不可读的门文件仍占据固定位置，保证其余文件可参与哈希。
      content = "<missing>";
    }
    hash.update(file).update("\0").update(content).update("\0");
  }

  const git = opts?.git ?? defaultGit;
  let gitSha: string | null = null;
  let dirty: boolean | null = null;
  try { gitSha = (await git(["rev-parse", "HEAD"], orchestratorRoot)).trim(); }
  catch { /* git 不可用时保留 null。 */ }
  try { dirty = (await git(["status", "--porcelain", "--", "src"], orchestratorRoot)).trim().length > 0; }
  catch { /* 两次 git 查询独立降级。 */ }

  let at = Date.now();
  try { at = (opts?.now ?? Date.now)(); }
  catch { /* 注入的时钟失败时使用系统时间。 */ }
  return { gitSha, dirty, gateHash: hash.digest("hex"), at };
}

export function defaultOrchestratorRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../..");
}
