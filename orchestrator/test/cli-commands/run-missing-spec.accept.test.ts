import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { locateSpecInput } from "../../src/cli-commands/devcycle.js";

function deps(files: Record<string, string>, repoRoot = "/repo", cwd = "/repo/orchestrator") {
  return {
    exists: (p: string) => Object.prototype.hasOwnProperty.call(files, p),
    read: (p: string) => {
      const v = files[p];
      if (v === undefined) throw new Error(`ENOENT ${p}`);
      return v;
    },
    repoRoot,
    cwd,
  };
}

describe("locateSpecInput：spec 路径读不到必须显式失败（作者锁定）", () => {
  test("一句话需求 → text", () => {
    expect(locateSpecInput("给对话加个导出按钮", deps({}))).toEqual({ kind: "text" });
    expect(locateSpecInput("第一行\n第二行 a.md", deps({}))).toEqual({ kind: "text" });
  });

  test("绝对路径存在 → file", () => {
    expect(locateSpecInput("/specs/a.md", deps({ "/specs/a.md": "# A\n正文" }))).toEqual({ kind: "file", path: "/specs/a.md" });
  });

  test("相对路径优先按 repoRoot 解析", () => {
    const files = { "/repo/docs/specs/x.md": "# X", "/repo/orchestrator/docs/specs/x.md": "# 错的那份" };
    expect(locateSpecInput("docs/specs/x.md", deps(files))).toEqual({ kind: "file", path: "/repo/docs/specs/x.md" });
  });

  test("repoRoot 下没有时退回 cwd", () => {
    const files = { "/repo/orchestrator/local.spec.md": "# L" };
    expect(locateSpecInput("local.spec.md", deps(files))).toEqual({ kind: "file", path: "/repo/orchestrator/local.spec.md" });
  });

  test("都不存在 → missing，tried 按 repoRoot、cwd 顺序", () => {
    expect(locateSpecInput("docs/specs/nope.md", deps({}))).toEqual({
      kind: "missing",
      tried: ["/repo/docs/specs/nope.md", "/repo/orchestrator/docs/specs/nope.md"],
    });
  });

  test("repoRoot 与 cwd 相同 → tried 去重", () => {
    expect(locateSpecInput("nope.md", deps({}, "/r", "/r"))).toEqual({ kind: "missing", tried: ["/r/nope.md"] });
  });

  test("绝对路径不存在 → missing 只含它本身", () => {
    expect(locateSpecInput("/abs/none.spec.md", deps({}))).toEqual({ kind: "missing", tried: ["/abs/none.spec.md"] });
  });

  test("内容全空白或读抛错 → 视同不可用", () => {
    expect(locateSpecInput("/s/blank.md", deps({ "/s/blank.md": "  \n " }))).toEqual({ kind: "missing", tried: ["/s/blank.md"] });
    const boom = { exists: () => true, read: () => { throw new Error("EACCES"); }, repoRoot: "/r", cwd: "/r" };
    expect(locateSpecInput("/s/x.md", boom)).toEqual({ kind: "missing", tried: ["/s/x.md"] });
  });
});

describe("run 命令接线（作者锁定，源码形状）", () => {
  const src = readFileSync(new URL("../../src/cli-commands/devcycle.ts", import.meta.url), "utf8");
  const runStart = src.indexOf('name: "run"');
  const runBody = src.slice(runStart, src.indexOf("registerCliCommand(", runStart + 10));

  test("run 在 resolveRequirementInput 之前调用 locateSpecInput", () => {
    expect(runStart).toBeGreaterThan(-1);
    const locateAt = runBody.indexOf("locateSpecInput(");
    const resolveAt = runBody.indexOf("resolveRequirementInput(");
    expect(locateAt).toBeGreaterThan(-1);
    expect(resolveAt).toBeGreaterThan(locateAt);
  });

  test("missing 分支报错并 exit(1)，传入 context.repoRoot", () => {
    expect(runBody).toMatch(/"missing"/);
    expect(runBody).toContain("读不到 spec 文件");
    expect(runBody).toMatch(/process\.exit\(1\)/);
    expect(runBody).toContain("context.repoRoot");
  });
});