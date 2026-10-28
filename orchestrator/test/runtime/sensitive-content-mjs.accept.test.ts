import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isTestFile, testWeakening, SENSITIVE_DIFF_TIMEOUT_MS } from "../../src/runtime/sensitive-content.js";
import { sensitiveHitsForBranch, SENSITIVE_DIFF_MAX_BUFFER } from "../../src/runtime/sensitive-branch.js";
import { GATE_MUTATIONS } from "../../src/verify/gate-mutation.js";

const N2 = 'import test from "node:test";\nimport assert from "node:assert/strict";\ntest("a", () => { assert.ok(1); assert.equal(1, 1); });\ntest("b", () => { assert.deepEqual([1], [1]); });\n';

describe("isTestFile", () => {
  it.each([
    "orchestrator/test/x.test.ts",
    "src/a.test.tsx",
    "scripts/lib/x.test.mjs",
    "a/b.spec.ts",
    "tests/c.test.cjs",
    "tests/spec-accept/apply-supplier-site.accept.mjs",
    "spec-accept/x.mjs",
  ])("%s → true", (p) => expect(isTestFile(p)).toBe(true));
  it.each([
    "orchestrator/src/app.ts",
    "scripts/test-helper.mjs",
    "docs/spec-accept.md",
    "tests/spec-accept/fixtures/data.json",
    "src/testing.ts",
  ])("%s → false", (p) => expect(isTestFile(p)).toBe(false));
});

describe("testWeakening 认 node:test 写法", () => {
  it("assert 断言变少 → 命中", () => {
    expect(testWeakening(N2, N2.replace(" assert.equal(1, 1);", ""))).toContain("断言");
  });
  it("{ skip: true } / { todo: true } 增多 → 命中", () => {
    expect(testWeakening(N2, N2.replace('test("b", ()', 'test("b", { skip: true }, ()'))).toContain("skip");
    expect(testWeakening(N2, N2.replace('test("a", ()', 'test("a", { todo: true }, ()'))).toContain("skip");
  });
  it("少一个 test( → 用例", () => {
    expect(testWeakening(N2, N2.replace(/test\("b"[^\n]*\n/, ""))).toContain("用例");
  });
  it("加用例、加 assert、expect 改写成等量 assert → 不命中", () => {
    expect(testWeakening(N2, N2 + 'test("c", () => { assert.ok(true); });\n')).toBeNull();
    expect(testWeakening(N2, N2.replace("assert.ok(1);", "assert.ok(1); assert(true);"))).toBeNull();
    const vit = 'it("a", () => { expect(1).toBe(1); });\n';
    expect(testWeakening(vit, 'it("a", () => { assert.equal(1, 1); });\n')).toBeNull();
  });
  it("原 vitest 判定不变", () => {
    const T2 = 'it("a", () => { expect(1).toBe(1); });\nit("b", () => { expect(2).toBe(2); });\n';
    expect(testWeakening(T2, T2.replace('it("b"', 'it.skip("b"'))).toContain("skip");
    expect(testWeakening(T2, 'it("a", () => { expect(1).toBe(1); });\nit("b", () => {});\n')).toContain("断言");
  });
});

describe("常量搬家后两边导出一致，且不再循环 import", () => {
  it("值不变", () => {
    expect(SENSITIVE_DIFF_TIMEOUT_MS).toBe(60_000);
    expect(SENSITIVE_DIFF_MAX_BUFFER).toBe(16 * 1024 * 1024);
  });
  it("sensitive-content.ts 不 import sensitive-branch", () => {
    const src = readFileSync(new URL("../../src/runtime/sensitive-content.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/from\s+["']\.\/sensitive-branch(?:\.js)?["']/);
  });
});

describe("sensitiveHitsForBranch 认 node:test 文件（真 git）", () => {
  let repo: string;
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  const write = (rel: string, text: string) => { mkdirSync(dirname(join(repo, rel)), { recursive: true }); writeFileSync(join(repo, rel), text); };

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "kp-content-mjs-"));
    git("init", "-q", "-b", "main");
    write("scripts/lib/x.test.mjs", N2);
    write("tests/spec-accept/guard.accept.mjs", N2);
    write("src/app.mjs", "export const a = 1;\n");
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

  it("删除 .test.mjs → 删除既有测试", async () => {
    const hits = await branch("del-mjs", () => rmSync(join(repo, "scripts/lib/x.test.mjs")));
    expect(hits).toContainEqual({ file: "scripts/lib/x.test.mjs", label: "删除既有测试" });
  });

  it("削弱 spec-accept 守门 → 削弱既有测试", async () => {
    const hits = await branch("weak-guard", () => write("tests/spec-accept/guard.accept.mjs", N2.replace(" assert.equal(1, 1);", "")));
    expect(hits).toContainEqual({ file: "tests/spec-accept/guard.accept.mjs", label: "削弱既有测试" });
  });

  it("新增 node:test 用例 + 改业务代码 → 不命中", async () => {
    const hits = await branch("ok-mjs", () => {
      write("scripts/lib/x.test.mjs", N2 + 'test("c", () => { assert.ok(true); });\n');
      write("scripts/lib/new.test.mjs", N2);
      write("src/app.mjs", "export const a = 2;\n");
    });
    expect(hits).toEqual([]);
  });
});

describe("门变异样本库有 node:test 削弱一枪", () => {
  it("sensitive-branch:weaken-node-test 被拦下", async () => {
    const m = GATE_MUTATIONS.find((x) => x.id === "sensitive-branch:weaken-node-test");
    expect(m?.gate).toBe("sensitive-branch");
    expect(await m!.run()).toBe(true);
  }, 30_000);
});