// 验收锚:渲染端的 data-action 必须有处理端认领;且检测器自身必须能报错(非恒真空门)。
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectRenderedActions,
  collectHandledActions,
  findUnhandledActions,
  type SourceFile,
} from "../../src/server/ui/action-parity.js";

const UI_DIR = fileURLToPath(new URL("../../src/server/ui/", import.meta.url));

function walk(dir: string, out: SourceFile[] = []): SourceFile[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (e.endsWith(".ts") && !e.endsWith(".test.ts")) out.push({ path: p, text: readFileSync(p, "utf8") });
  }
  return out;
}

const all = walk(UI_DIR);
const clientSources = all.filter((f) => f.path.includes("client-parts"));
const renderSources = all.filter((f) => !f.path.includes("client-parts"));

describe("检测器自身有效(非恒真空门)", () => {
  it("合成坏样本:渲染端发出、处理端没有 → 必须报出来", () => {
    const bad = findUnhandledActions(
      [{ path: "v.ts", text: '<button data-action="ghost-button">x</button>' }],
      [{ path: "c.ts", text: 'if (action === "something-else") {}' }],
    );
    expect(bad).toHaveLength(1);
    expect(bad[0].action).toBe("ghost-button");
    expect(bad[0].files).toEqual(["v.ts"]);
  });

  it("合成好样本:处理端认领了 → 空数组", () => {
    const ok = findUnhandledActions(
      [{ path: "v.ts", text: '<button data-action="real-button">x</button>' }],
      [{ path: "c.ts", text: 'if (action === "real-button") { doIt(); }' }],
    );
    expect(ok).toEqual([]);
  });

  it("处理端用映射表键或动态拼字符串也算认领", () => {
    expect(findUnhandledActions(
      [{ path: "v.ts", text: 'data-action="via-map"' }],
      [{ path: "c.ts", text: 'const H = { "via-map": run };' }],
    )).toEqual([]);
    expect(findUnhandledActions(
      [{ path: "v.ts", text: 'data-action="via-template"' }],
      [{ path: "c.ts", text: "var s = `via-template`;" }],
    )).toEqual([]);
  });

  it("多个坏 action 按字典序稳定返回", () => {
    const bad = findUnhandledActions(
      [{ path: "v.ts", text: 'data-action="zeta" data-action="alpha"' }],
      [{ path: "c.ts", text: "" }],
    );
    expect(bad.map((b) => b.action)).toEqual(["alpha", "zeta"]);
  });
});

describe("收集器口径", () => {
  it("单引号与双引号都认", () => {
    const m = collectRenderedActions([{ path: "v.ts", text: `data-action="a1" data-action='a2'` }]);
    expect([...m.keys()].sort()).toEqual(["a1", "a2"]);
  });

  it("同一 action 出现在多文件时归并", () => {
    const m = collectRenderedActions([
      { path: "x.ts", text: 'data-action="dup"' },
      { path: "y.ts", text: 'data-action="dup"' },
    ]);
    expect(m.get("dup")).toEqual(["x.ts", "y.ts"]);
  });

  it("处理端收集到带引号的字面量", () => {
    const s = collectHandledActions([{ path: "c.ts", text: 'action === "h1"; case "h2":' }]);
    expect(s.has("h1")).toBe(true);
    expect(s.has("h2")).toBe(true);
  });

  it("纯函数:不读文件系统", () => {
    expect(() => collectRenderedActions([])).not.toThrow();
    expect(collectRenderedActions([]).size).toBe(0);
    expect(collectHandledActions([]).size).toBe(0);
  });
});

describe("仓库现状", () => {
  it("扫到了一批真实 action(扫描器接对了源)", () => {
    expect(collectRenderedActions(renderSources).size).toBeGreaterThan(40);
    expect(collectHandledActions(clientSources).size).toBeGreaterThan(40);
  });

  it("没有死按钮:渲染端每个 action 都有处理端认领", () => {
    const dead = findUnhandledActions(renderSources, clientSources);
    expect(dead.map((d) => `${d.action} ← ${d.files.join(",")}`)).toEqual([]);
  });
});