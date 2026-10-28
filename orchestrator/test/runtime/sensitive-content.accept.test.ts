import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scriptsChanged, testWeakening } from "../../src/runtime/sensitive-content.js";
import { sensitiveHitsForBranch } from "../../src/runtime/sensitive-branch.js";
import { GATE_MUTATIONS } from "../../src/verify/gate-mutation.js";

const T2 = 'import { it, expect } from "vitest";\nit("a", () => { expect(1).toBe(1); });\nit("b", () => { expect(2).toBe(2); });\n';

describe("testWeakening", () => {
  it("少用例 → 命中", () => {
    expect(testWeakening(T2, 'it("a", () => { expect(1).toBe(1); expect(2).toBe(2); });\n')).toContain("用例");
  });
  it("少断言 → 命中", () => {
    expect(testWeakening(T2, 'it("a", () => { expect(1).toBe(1); });\nit("b", () => {});\n')).toContain("断言");
  });
  it("加 skip / only → 命中", () => {
    expect(testWeakening(T2, T2.replace('it("b"', 'it.skip("b"'))).toContain("skip");
    expect(testWeakening(T2, T2.replace('it("a"', 'it.only("a"'))).toContain("skip");
  });
  it("加用例、加断言、只改文案 → 不命中", () => {
    expect(testWeakening(T2, T2 + 'it("c", () => { expect(3).toBe(3); });\n')).toBeNull();
    expect(testWeakening(T2, T2.replace("expect(1).toBe(1);", "expect(1).toBe(1); expect(1).not.toBe(0);"))).toBeNull();
    expect(testWeakening(T2, T2.replace('it("a"', 'it("a renamed"'))).toBeNull();
  });
  it("it.each 计为用例", () => {
    const each = 'it.each([1, 2])("x %s", (n) => { expect(n).toBeGreaterThan(0); });\n';
    expect(testWeakening(each + T2, T2)).toContain("用例");
  });
});

describe("scriptsChanged", () => {
  const pkg = (scripts: Record<string, string>, deps: Record<string, string> = {}) => JSON.stringify({ name: "x", scripts, dependencies: deps }, null, 2);
  it("改 test 脚本 → true", () => {
    expect(scriptsChanged(pkg({ test: "vitest run" }), pkg({ test: "echo ok" }))).toBe(true);
  });
  it("只改依赖或键序 → false", () => {
    expect(scriptsChanged(pkg({ test: "vitest run", lint: "eslint" }, { a: "1" }), pkg({ lint: "eslint", test: "vitest run" }, { a: "2" }))).toBe(false);
  });
  it("解析失败 → true（fail-closed）", () => {
    expect(scriptsChanged(pkg({ test: "vitest run" }), "{ not json")).toBe(true);
  });
});

describe("sensitiveHitsForBranch 合并内容命中（真 git）", () => {
  let repo: string;
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  const write = (rel: string, text: string) => { mkdirSync(dirname(join(repo, rel)), { recursive: true }); writeFileSync(join(repo, rel), text); };

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "kp-content-"));
    git("init", "-q", "-b", "main");
    write("orchestrator/test/x.test.ts", T2);
    write("orchestrator/test/keep.test.ts", T2);
    write("orchestrator/package.json", JSON.stringify({ name: "o", scripts: { test: "vitest run" }, dependencies: { a: "1" } }));
    write("orchestrator/src/app.ts", "export const a = 1;\n");
    git("add", ".");
    git("commit", "-qm", "base");
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  async function branch(name: string, change: () => void) {
    git("checkout", "-qb", `kp/${name}`);
    change();
    git("add", "-A");
    git("commit", "-qm", name);
    git("checkout", "-q", "main");
    return sensitiveHitsForBranch(repo, name, "main");
  }

  it("删除既有测试 → 命中", async () => {
    const hits = await branch("del", () => rmSync(join(repo, "orchestrator/test/x.test.ts")));
    expect(hits.map((h) => h.label)).toContain("删除既有测试");
  });

  it("削弱既有测试 → 命中", async () => {
    const hits = await branch("weak", () => write("orchestrator/test/x.test.ts", 'it("a", () => { expect(1).toBe(1); });\n'));
    expect(hits).toContainEqual({ file: "orchestrator/test/x.test.ts", label: "削弱既有测试" });
  });

  it("改 scripts → 命中；只改依赖 → 不命中", async () => {
    const hits = await branch("scripts", () => write("orchestrator/package.json", JSON.stringify({ name: "o", scripts: { test: "echo ok" }, dependencies: { a: "1" } })));
    expect(hits.map((h) => h.label)).toContain("测试/构建脚本改动");
    const deps = await branch("deps", () => write("orchestrator/package.json", JSON.stringify({ name: "o", scripts: { test: "vitest run" }, dependencies: { a: "2" } })));
    expect(deps).toEqual([]);
  });

  it("新增测试 + 给既有测试加断言 + 改业务代码 → 不命中", async () => {
    const hits = await branch("ok", () => {
      write("orchestrator/test/new.test.ts", T2);
      write("orchestrator/test/keep.test.ts", T2.replace("expect(1).toBe(1);", "expect(1).toBe(1); expect(1).not.toBe(0);"));
      write("orchestrator/src/app.ts", "export const a = 2;\n");
    });
    expect(hits).toEqual([]);
  });
});

describe("门变异样本库有两枪内容判定", () => {
  it.each(["sensitive-branch:weaken-test", "sensitive-branch:scripts-change"])("%s 被拦下", async (id) => {
    const m = GATE_MUTATIONS.find((x) => x.id === id);
    expect(m?.gate).toBe("sensitive-branch");
    expect(await m!.run()).toBe(true);
  }, 30_000);
});