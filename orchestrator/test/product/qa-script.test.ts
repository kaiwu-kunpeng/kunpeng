import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readQaScript, executeQaScript, type QaPageLike, type QaScriptStep } from "../../src/product/qa-script.js";
import { qaVerdict } from "../../src/product/browser-qa.js";

function fakePage(over: Partial<QaPageLike> = {}): QaPageLike & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    goto: async (u) => { calls.push(`goto:${u}`); },
    click: async (s) => { calls.push(`click:${s}`); },
    fill: async (s, v) => { calls.push(`fill:${s}=${v}`); },
    bodyText: async () => "欢迎使用便签墙 新增便签",
    count: async () => 1,
    ...over,
  };
}

describe("readQaScript", () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), "kp-qs-")); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it("读脚本、过滤坏项；缺文件/坏档返回空", async () => {
    const dir = join(root, ".kunpeng", "product", "demo");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "qa-script.json"), JSON.stringify([
      { action: "goto", target: "/" },
      { action: "teleport", target: "/x" },
      "not-an-object",
      { action: "expectText", value: "便签" },
    ]));
    const steps = await readQaScript(root, "demo");
    expect(steps.map((s) => s.action)).toEqual(["goto", "expectText"]);
    expect(await readQaScript(root, "missing")).toEqual([]);
    writeFileSync(join(dir, "qa-script.json"), "{broken");
    expect(await readQaScript(root, "demo")).toEqual([]);
  });
});

describe("executeQaScript", () => {
  const steps: QaScriptStep[] = [
    { action: "goto", target: "/" },
    { action: "fill", target: "#note", value: "hello" },
    { action: "click", target: "#add" },
    { action: "expectText", value: "便签" },
    { action: "expectSelector", target: ".note-card" },
  ];

  it("全绿路径：顺序执行且 goto 拼 baseUrl", async () => {
    const page = fakePage();
    const results = await executeQaScript(page, "http://localhost:4310", steps);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(results.length).toBe(5);
    expect(page.calls[0]).toBe("goto:http://localhost:4310/");
  });

  it("断言失败/动作抛错 → 记错并中止后续", async () => {
    const page = fakePage({ bodyText: async () => "完全无关的内容" });
    const results = await executeQaScript(page, "http://x", steps);
    expect(results.length).toBe(4);
    expect(results[3].ok).toBe(false);
    expect(results[3].error).toBeTruthy();

    const boom = fakePage({ click: async () => { throw new Error("no such element"); } });
    const r2 = await executeQaScript(boom, "http://x", steps);
    expect(r2.length).toBe(3);
    expect(r2[2].ok).toBe(false);
    expect(r2[2].error).toContain("no such element");
  });
});

describe("qaVerdict 合流 scriptFailures", () => {
  it("脚本失败进 problems", () => {
    const v = qaVerdict({ status: 200, bodyTextLength: 300, consoleErrors: [], interactiveCount: 3, scriptFailures: ["步骤3 click #add: no such element"] });
    expect(v.ok).toBe(false);
    expect(v.problems.some((p) => p.includes("脚本") && p.includes("#add"))).toBe(true);
  });
});