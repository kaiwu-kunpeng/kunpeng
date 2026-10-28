import { describe, it, expect } from "vitest";
import { buildMemoryContextBM25 } from "../../src/knowledge/memory-context.js";

const base = { tags: [] as string[] };

describe("buildMemoryContextBM25", () => {
  it("promoted 条目在同等相关性下排前", () => {
    const out = buildMemoryContextBM25(
      [
        { ...base, raw: "登录限流 实现经验 甲", summary: "普通条目：登录限流经验甲", promoted: false },
        { ...base, raw: "登录限流 实现经验 乙", summary: "采纳条目：登录限流经验乙", promoted: true },
      ],
      "登录限流",
      { k: 1 },
    );
    expect(out).toContain("采纳条目");
    expect(out).not.toContain("普通条目");
  });

  it("distillLevel 加权生效", () => {
    const out = buildMemoryContextBM25(
      [
        { ...base, raw: "SSE 推送 分帧 经验 甲", summary: "浅条目", distillLevel: 0 },
        { ...base, raw: "SSE 推送 分帧 经验 乙", summary: "深读条目", distillLevel: 3 },
      ],
      "SSE 分帧",
      { k: 1 },
    );
    expect(out).toContain("深读条目");
  });

  it("无命中返回空串；命中时带标准块头", () => {
    expect(buildMemoryContextBM25([{ ...base, raw: "毫不相关的内容" }], "zzzz-无关查询")).toBe("");
    const out = buildMemoryContextBM25([{ ...base, raw: "登录限流经验", summary: "登录限流经验" }], "登录限流");
    expect(out.startsWith("## 相关经验（方法论资产）")).toBe(true);
  });
});