import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GateGit } from "./gate-diagnosis.js";
import type { GateFutilityGit } from "./gate-futility.js";

const execFileAsync = promisify(execFile);

/** 真 git 实现的「门是否过不去」探针：分支是否存在 + 相对 base 的合并 diff 是否为空。
 *  供 autopilot 注入 classifyGateFutility，用来在自转中自动驳回永远过不去的门（空提交/分支没了）。 */
export function gateFutilityAdapter(repoRoot: string): GateFutilityGit {
  const git = (args: string[]) => execFileAsync("git", ["-C", repoRoot, ...args]);

  return {
    async branchExists(branch) {
      const stdout = await git(["rev-parse", "--verify", "--quiet", branch])
        .then((result) => result.stdout.trim())
        .catch(() => "");
      return stdout !== "";
    },

    async mergeDiffEmpty(branch, base) {
      // 三点式 diff：base...branch 取的是「branch 相对二者公共祖先」的实际改动——
      // 与合并审查闸 diffForReview 的口径一致，空＝合并审查必拒（空提交/已被 base 吸收）。
      const stdout = await git(["diff", "--name-only", `${base}...${branch}`])
        .then((result) => result.stdout.trim())
        .catch(() => "x"); // 探测失败一律当「非空」，保守：交给后续 merge/review 决定，绝不误判 futile 而驳回。
      return stdout === "";
    },
  };
}

export function gitGateAdapter(repoRoot: string): GateGit {
  const git = (args: string[]) => execFileAsync("git", ["-C", repoRoot, ...args]);

  return {
    async branchExists(branch) {
      const stdout = await git(["rev-parse", "--verify", "--quiet", branch])
        .then((result) => result.stdout.trim())
        .catch(() => "");
      return stdout !== "";
    },

    async unmergedCommits(branch, base) {
      const stdout = await git(["cherry", base, branch])
        .then((result) => result.stdout)
        .catch(() => "");
      return stdout.split("\n").filter((line) => line.startsWith("+")).length;
    },

    async commitsBehind(branch, base) {
      const stdout = await git(["rev-list", "--count", `${branch}..${base}`])
        .then((result) => result.stdout.trim())
        .catch(() => "0");
      const count = Number.parseInt(stdout, 10);
      return Number.isFinite(count) ? count : 0;
    },

    async mergeConflictFiles(branch, base) {
      try {
        await git(["merge-tree", "--write-tree", "--name-only", base, branch]);
        return [];
      } catch (error) {
        const stdout = String((error as { stdout?: unknown }).stdout ?? "");
        const lines = stdout.split("\n");
        const files: string[] = [];

        for (let index = 1; index < lines.length; index += 1) {
          const line = lines[index].trim();
          if (line === "") break;
          files.push(line);
        }

        return files.length > 0 ? files : ["(conflict)"];
      }
    },
  };
}
