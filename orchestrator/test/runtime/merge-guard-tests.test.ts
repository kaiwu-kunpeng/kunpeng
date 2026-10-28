import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { DEFAULT_GUARD_TEST_FILTERS, resolveGuardTestFilters, runGuardTests } from "../../src/runtime/merge-guard-tests.js";

let repo: string;
async function initRepo(withOrchestrator: boolean): Promise<void> {
  const g = simpleGit(repo);
  await g.init();
  await g.addConfig("user.email", "t@t.t");
  await g.addConfig("user.name", "t");
  await g.checkoutLocalBranch("main");
  writeFileSync(join(repo, "README.md"), "base\n");
  if (withOrchestrator) {
    mkdirSync(join(repo, "orchestrator"), { recursive: true });
    writeFileSync(join(repo, "orchestrator", "package.json"), "{}\n");
  }
  await g.add(".");
  await g.commit("init");
  await g.checkoutLocalBranch("kp/g1");
  writeFileSync(join(repo, "from-branch.txt"), "branch\n");
  await g.add(".");
  await g.commit("branch work");
  await g.checkout("main");
  writeFileSync(join(repo, "main-later.txt"), "later\n");
  await g.add(".");
  await g.commit("main moved on");
}
beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "kp-guard-")); });
afterEach(() => rmSync(repo, { recursive: true, force: true }));

const worktrees = async () => (await simpleGit(repo).raw(["worktree", "list", "--porcelain"])).split("\n").filter((l) => l.startsWith("worktree ")).length;

describe("守门测试筛选（作者锁定）", () => {
  it("缺省清单覆盖守门器；off/0/false 关；逗号清单解析", () => {
    expect(DEFAULT_GUARD_TEST_FILTERS.length).toBeGreaterThanOrEqual(8);
    for (const f of ["sensitive-paths", "merge-gate", "authz", "scope-main-gate", "p0-regression", "gate-mode", "hooks"]) {
      expect(DEFAULT_GUARD_TEST_FILTERS).toContain(f);
    }
    expect(resolveGuardTestFilters({})).toEqual([...DEFAULT_GUARD_TEST_FILTERS]);
    expect(resolveGuardTestFilters({ KUNPENG_GUARD_TESTS: "off" })).toEqual([]);
    expect(resolveGuardTestFilters({ KUNPENG_GUARD_TESTS: " 0 " })).toEqual([]);
    expect(resolveGuardTestFilters({ KUNPENG_GUARD_TESTS: "a, b ,,c" })).toEqual(["a", "b", "c"]);
  });
});

describe("预览合并 + 守门测试（作者锁定）", () => {
  it("绿：在临时 worktree 的 orchestrator 里跑 vitest，预览合并含分支与主干双方改动，跑完 worktree 已删", async () => {
    await initRepo(true);
    const seen: { file?: string; args?: string[]; cwd?: string; hadBoth?: boolean; nodeModulesLinked?: boolean } = {};
    const r = await runGuardTests({
      repoRoot: repo, flowId: "g1", base: "main", filters: ["alpha", "beta"],
      exec: async (file, args, cwd) => {
        seen.file = file; seen.args = args; seen.cwd = cwd;
        seen.hadBoth = existsSync(join(cwd, "..", "from-branch.txt")) && existsSync(join(cwd, "..", "main-later.txt"));
        return { exitCode: 0, output: "ok" };
      },
    });
    expect(r.status).toBe("green");
    expect(r.summary).toContain("2");
    expect(seen.file).toBe("npx");
    expect(seen.args).toEqual(["--no-install", "vitest", "run", "alpha", "beta"]);
    expect(seen.cwd).not.toBe(join(repo, "orchestrator"));
    expect(seen.cwd!.endsWith("orchestrator")).toBe(true);
    expect(seen.hadBoth).toBe(true);
    expect(existsSync(seen.cwd!)).toBe(false);
    expect(await worktrees()).toBe(1);
    expect(r.logPath && existsSync(r.logPath)).toBe(true);
    expect(readFileSync(r.logPath!, "utf8")).toContain("# cmd: npx --no-install vitest run alpha beta");
  });

  it("红：非零退出 → red，summary 取输出尾部，日志落在 .kunpeng/guard-logs/<flowId>/", async () => {
    await initRepo(true);
    const output = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).concat(["", "× guard failed here"]).join("\n");
    const r = await runGuardTests({ repoRoot: repo, flowId: "g1", base: "main", filters: ["x"], exec: async () => ({ exitCode: 1, output }) });
    expect(r.status).toBe("red");
    expect(r.summary).toContain("× guard failed here");
    expect(r.summary).not.toContain("line 1\n");
    expect(r.logPath).toBe(join(repo, ".kunpeng", "guard-logs", "g1", "1.txt"));
    expect(readFileSync(r.logPath!, "utf8")).toContain("line 60");
    expect(await worktrees()).toBe(1);
  });

  it("没有 orchestrator/package.json 的仓库 → skipped，不建 worktree、不调 exec", async () => {
    await initRepo(false);
    let called = 0;
    const r = await runGuardTests({ repoRoot: repo, flowId: "g1", base: "main", filters: ["x"], exec: async () => { called += 1; return { exitCode: 0, output: "" }; } });
    expect(r.status).toBe("skipped");
    expect(called).toBe(0);
    expect(await worktrees()).toBe(1);
  });

  it("filters 为空 → skipped 且不调 exec", async () => {
    await initRepo(true);
    let called = 0;
    const r = await runGuardTests({ repoRoot: repo, flowId: "g1", base: "main", filters: [], exec: async () => { called += 1; return { exitCode: 0, output: "" }; } });
    expect(r.status).toBe("skipped");
    expect(called).toBe(0);
  });

  it("预览合并冲突 → skipped（交给刷新闸），不调 exec，worktree 已删", async () => {
    await initRepo(true);
    const g = simpleGit(repo);
    await g.checkout("kp/g1");
    writeFileSync(join(repo, "README.md"), "branch says\n");
    await g.add(".");
    await g.commit("branch edits README");
    await g.checkout("main");
    writeFileSync(join(repo, "README.md"), "main says\n");
    await g.add(".");
    await g.commit("main edits README");
    let called = 0;
    const r = await runGuardTests({ repoRoot: repo, flowId: "g1", base: "main", filters: ["x"], exec: async () => { called += 1; return { exitCode: 0, output: "" }; } });
    expect(r.status).toBe("skipped");
    expect(r.summary).toContain("预览合并");
    expect(called).toBe(0);
    expect(await worktrees()).toBe(1);
  });

  it("超时兜底：注入的 exec 拖着不返回也会在 timeoutMs 后判 red", async () => {
    await initRepo(true);
    const r = await runGuardTests({
      repoRoot: repo, flowId: "g1", base: "main", filters: ["x"], timeoutMs: 40,
      exec: () => new Promise((resolve) => setTimeout(() => resolve({ exitCode: 0, output: "late" }), 400)),
    });
    expect(r.status).toBe("red");
    expect(r.summary).toContain("超时");
    expect(await worktrees()).toBe(1);
  });
});