import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { parseSpecBriefFields } from "../../src/product/spec-parse.js";
import { definitionToSpec } from "../../src/product/to-spec.js";
import type { ProductDefinition } from "../../src/product/contract.js";

const orchSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "product", "loop-orchestrate.ts"),
  "utf8",
);

const def = {
  idea: "发票核对助手",
  problem: "财务每天手工核对 300 张发票，耗时 2 小时且易错",
  users: ["财务专员", "财务主管"],
  stories: ["当财务导入发票时，系统自动比对并标出差异", "当差异超阈值时，自动生成复核任务"],
  acceptance: ["核对耗时降到 10 分钟以内"],
  jobStatement: "当我拿到一批发票时，我要快速找出差异",
  nonGoals: ["不做报税"],
} as unknown as ProductDefinition;

describe("parseSpecBriefFields 从 spec 反解", () => {
  const spec = definitionToSpec(def);

  it("取回 idea", () => {
    expect(parseSpecBriefFields(spec).idea).toBe("发票核对助手");
  });

  it("取回 problem", () => {
    expect(parseSpecBriefFields(spec).problem).toContain("300 张发票");
  });

  it("取回 users 列表", () => {
    expect(parseSpecBriefFields(spec).users).toEqual(["财务专员", "财务主管"]);
  });

  it("取回 stories 列表", () => {
    expect(parseSpecBriefFields(spec).stories?.[0]).toContain("自动比对");
  });

  it("人工改过的 users 反映改后内容", () => {
    const edited = spec.replace("- 财务专员", "- 门店店长");
    expect(parseSpecBriefFields(edited).users?.[0]).toBe("门店店长");
  });

  it("空串与无关文本返回空对象且不抛错", () => {
    expect(() => parseSpecBriefFields("")).not.toThrow();
    expect(parseSpecBriefFields("")).toEqual({});
    expect(parseSpecBriefFields("随便一段没有锚点的文字")).toEqual({});
  });

  it("未命名需求不产出 idea", () => {
    const anon = definitionToSpec({ ...def, idea: "" } as unknown as ProductDefinition);
    expect(parseSpecBriefFields(anon).idea).toBeUndefined();
  });
});

describe("applyPivot 先存快照、先算后写", () => {
  it("snapshotLoop 出现在任何 write 之前", () => {
    const idx = orchSrc.indexOf("export async function applyPivot");
    expect(idx).toBeGreaterThan(-1);
    const body = orchSrc.slice(idx, idx + 2200);
    const snap = body.indexOf("snapshotLoop");
    const firstWrite = body.indexOf("writeSpec");
    expect(snap).toBeGreaterThan(-1);
    expect(firstWrite).toBeGreaterThan(-1);
    expect(snap).toBeLessThan(firstWrite);
  });

  it("specToBuildSpec 在第一个 writeSpec 之前算完", () => {
    const idx = orchSrc.indexOf("export async function applyPivot");
    const body = orchSrc.slice(idx, idx + 2200);
    expect(body.indexOf("specToBuildSpec")).toBeLessThan(body.indexOf("writeSpec"));
  });
});

describe("accept 时 BRIEF 吃 spec", () => {
  it("spec 分支会读 spec 并解析", () => {
    expect(orchSrc).toContain("parseSpecBriefFields");
  });
});