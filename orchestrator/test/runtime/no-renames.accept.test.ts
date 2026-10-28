import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sensitiveHitsForBranch } from "../../src/runtime/sensitive-branch.js";
import { findStaleDeletions } from "../../src/runtime/merge-deletion-guard.js";
import { GATE_MUTATIONS } from "../../src/verify/gate-mutation.js";

const SRC = new URL("../../src/", import.meta.url).pathname;
const BODY = Array.from({ length: 30 }, () => "export const same = 1;").join("\n") + "\n";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).trim();
}

let repo: string;
beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "kp-norename-"));
  git(repo, "init", "-q", "-b", "main");
  mkdirSync(join(repo, "orchestrator", "src", "runtime"), { recursive: true });
  writeFileSync(join(repo, "orchestrator", "src", "runtime", "sensitive-paths.ts"), BODY);
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "base");
  git(repo, "checkout", "-qb", "kp/mv");
  git(repo, "mv", "orchestrator/src/runtime/sensitive-paths.ts", "orchestrator/src/runtime/paths-x.ts");
  git(repo, "commit", "-qm", "rename away");
  git(repo, "checkout", "-q", "main");
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("改名不再藏路径", () => {
  it("前提：默认 name-only 只看得到新路径", () => {
    expect(git(repo, "diff", "--name-only", "main...kp/mv")).toBe("orchestrator/src/runtime/paths-x.ts");
  });

  it("sensitiveHitsForBranch 命中被改名挪走的敏感旧路径", async () => {
    const hits = await sensitiveHitsForBranch(repo, "mv", "main");
    expect(hits.map((h) => h.file)).toContain("orchestrator/src/runtime/sensitive-paths.ts");
  });

  it("误删检测把改名导致的旧路径消失算作删除", async () => {
    const before = git(repo, "rev-parse", "main");
    git(repo, "merge", "-q", "--no-ff", "-m", "merge", "kp/mv");
    const after = git(repo, "rev-parse", "main");
    const deleted: string[][] = [];
    await findStaleDeletions({
      diffNames: async (args) => {
        const out = git(repo, "diff", ...args).split("\n").filter(Boolean);
        deleted.push(out);
        return out;
      },
      mergeBase: async (a, b) => git(repo, "merge-base", a, b),
    }, before, after, "kp/mv");
    expect(deleted[0]).toContain("orchestrator/src/runtime/sensitive-paths.ts");
  });
});

describe("调用点源码都带 --no-renames", () => {
  const files = [
    "runtime/sensitive-branch.ts",
    "server/autopilot-guards.ts",
    "plan/orchestrator.ts",
    "runtime/merge-deletion-guard.ts",
    "cli-commands/devcycle.ts",
    "loop/dev-cycle.ts",
  ];
  it.each(files)("%s", (file) => {
    const src = readFileSync(join(SRC, file), "utf8");
    expect(src).toContain("--no-renames");
    expect(src).not.toMatch(/\["diff", "--name-only"/);
    expect(src).not.toMatch(/"diff",\s*\n\s*"--name-only"/);
    expect(src).not.toMatch(/\["--diff-filter=D"/);
  });
});

describe("门变异样本库有改名一枪", () => {
  it("sensitive-branch:rename-away 存在且被拦下", async () => {
    const m = GATE_MUTATIONS.find((x) => x.id === "sensitive-branch:rename-away");
    expect(m?.gate).toBe("sensitive-branch");
    expect(await m!.run()).toBe(true);
  }, 30_000);
});