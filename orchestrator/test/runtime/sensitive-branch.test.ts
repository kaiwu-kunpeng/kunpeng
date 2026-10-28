import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  SENSITIVE_DIFF_MAX_BUFFER,
  SENSITIVE_DIFF_TIMEOUT_MS,
  changedFilesForBranch,
  sensitiveHitsForBranch,
  type GitDiffRunner,
} from "../../src/runtime/sensitive-branch.js";

const execFileAsync = promisify(execFile);

/** 记录调用参数、按脚本返回 stdout 的假 git。 */
function fakeGit(stdout: string | Buffer) {
  const calls: Array<{ file: string; args: string[]; opts: { cwd: string; timeout: number; maxBuffer: number } }> = [];
  const run: GitDiffRunner = async (file, args, opts) => {
    calls.push({ file, args, opts });
    return { stdout };
  };
  return { run, calls };
}

describe("sensitiveHitsForBranch / changedFilesForBranch(作者锁定)", () => {
  it("按 autopilot 同款参数调 git diff --name-only <base>...kp/<flowId>,cwd=repoRoot,60 s 超时,16 MB 缓冲", async () => {
    const git = fakeGit("lib/a.ts\n");
    await changedFilesForBranch("/repo", "flow-1", "main", git.run);
    expect(git.calls).toEqual([{
      file: "git",
      args: ["diff", "--no-renames", "--name-only", "main...kp/flow-1"],
      opts: { cwd: "/repo", timeout: 60_000, maxBuffer: 16 * 1024 * 1024 },
    }]);
    expect(SENSITIVE_DIFF_TIMEOUT_MS).toBe(60_000);
    expect(SENSITIVE_DIFF_MAX_BUFFER).toBe(16 * 1024 * 1024);
  });

  it("注入的 diff 输出经 classifySensitiveFiles:命中敏感文件才有 hits,去空行、CRLF 与 Buffer 都能处理", async () => {
    const mixed = fakeGit(Buffer.from("orchestrator/src/loop/learnings.ts\r\norchestrator/src/server/auth.ts\n\n.kunpeng/accounts.json\n"));
    expect(await changedFilesForBranch("/repo", "f", "main", mixed.run)).toEqual([
      "orchestrator/src/loop/learnings.ts",
      "orchestrator/src/server/auth.ts",
      ".kunpeng/accounts.json",
    ]);
    expect(await sensitiveHitsForBranch("/repo", "f", "main", mixed.run)).toEqual([
      { file: "orchestrator/src/server/auth.ts", label: "鉴权/授权" },
      { file: ".kunpeng/accounts.json", label: "模型账号表" },
    ]);

    const plain = fakeGit("lib/i18n.ts\ndocs/specs/2026-09-07-secret-handling.md\n");
    expect(await sensitiveHitsForBranch("/repo", "f", "main", plain.run)).toEqual([]);
    expect(await sensitiveHitsForBranch("/repo", "f", "main", fakeGit("").run)).toEqual([]);
  });

  it("git 失败原样抛出(不吞成「不敏感」,由调用方保守留门)", async () => {
    const boom: GitDiffRunner = async () => { throw new Error("fatal: bad revision 'main...kp/ghost'"); };
    await expect(sensitiveHitsForBranch("/repo", "ghost", "main", boom)).rejects.toThrow("bad revision");
  });

  it("缺省执行器走真 git:分支改了 src/server/auth.ts → 命中;只改 lib → 空;分支不存在 → 抛错", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kp-sens-branch-"));
    const git = (...args: string[]) => execFileAsync("git", args, { cwd: dir });
    await git("init", "-b", "main");
    await git("config", "user.email", "t@example.com");
    await git("config", "user.name", "t");
    await mkdir(join(dir, "lib"), { recursive: true });
    await writeFile(join(dir, "lib", "i18n.ts"), "export const a = 1;\n");
    await git("add", "lib/i18n.ts");
    await git("commit", "-m", "base");
    for (const [flowId, files] of Object.entries({ "flow-auth": ["src/server/auth.ts", "lib/i18n.ts"], "flow-plain": ["lib/i18n.ts"] })) {
      await git("checkout", "-b", `kp/${flowId}`, "main");
      for (const file of files) {
        await mkdir(dirname(join(dir, file)), { recursive: true });
        await writeFile(join(dir, file), `// ${flowId}\n`);
        await git("add", file);
      }
      await git("commit", "-m", flowId);
    }
    await git("checkout", "main");

    expect(await sensitiveHitsForBranch(dir, "flow-auth", "main")).toEqual([{ file: "src/server/auth.ts", label: "鉴权/授权" }]);
    expect(await sensitiveHitsForBranch(dir, "flow-plain", "main")).toEqual([]);
    await expect(sensitiveHitsForBranch(dir, "no-such-flow", "main")).rejects.toThrow();
  });
});