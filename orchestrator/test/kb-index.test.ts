import { describe, it, expect } from "vitest";
import { aggregateCaptures, buildKbResponse, renderKbIndex } from "../src/knowledge/kb-index.js";

const cap = (id: string, summary: string, createdAt: number, tags: string[] = []) =>
  ({ id, source: "text" as const, kind: "text", raw: summary, summary, tags, createdAt, promoted: false });

const perProject = [
  { projectId: "a", projectName: "Alpha", captures: [cap("c1", "支付生态调研", 100, ["支付", "中国"]), cap("c2", "SEO 打法", 300)] },
  { projectId: "b", projectName: "Beta", captures: [cap("c3", "竞品分析", 200), cap("c1", "重复 id", 999)] },
];

describe("aggregateCaptures", () => {
  it("跨项目拍平、按 createdAt 降序", () => {
    const e = aggregateCaptures(perProject);
    expect(e.map((x) => x.id)).toEqual(["c2", "c3", "c1"]);
  });
  it("按 id 去重(同 id 取先出现)", () => {
    const e = aggregateCaptures(perProject);
    expect(e.filter((x) => x.id === "c1").length).toBe(1);
    expect(e.find((x) => x.id === "c1")?.projectName).toBe("Alpha");
  });
  it("query 过滤命中 summary/tags(小写包含)", () => {
    const e = aggregateCaptures(perProject, "支付");
    expect(e.map((x) => x.id)).toEqual(["c1"]);
  });
  it("query 无命中 → 空", () => {
    expect(aggregateCaptures(perProject, "不存在的词")).toEqual([]);
  });
});

describe("renderKbIndex", () => {
  it("非空 → 表格含条目", () => {
    const md = renderKbIndex(aggregateCaptures(perProject));
    expect(md).toContain("跨项目知识库索引(3 条)");
    expect(md).toContain("| 项目 | 摘要 |");
    expect(md).toContain("Alpha");
    expect(md).toContain("c2");
  });
  it("空 → 占位", () => {
    expect(renderKbIndex([])).toContain("无匹配条目");
  });
});

describe("buildKbResponse", () => {
  const pp = [
    { projectId: "a", projectName: "Alpha", captures: [cap("c1", "支付调研", 100, ["支付"]), cap("c2", "SEO", 200)] },
    { projectId: "b", projectName: "Beta", captures: [cap("c3", "竞品", 300)] },
  ];

  it("count/projectCount/entries 正确", () => {
    const r = buildKbResponse(pp);
    expect(r.projectCount).toBe(2);
    expect(r.count).toBe(3);
    expect(r.entries[0].id).toBe("c3");
  });

  it("query 过滤", () => {
    const r = buildKbResponse(pp, "支付");
    expect(r.count).toBe(1);
    expect(r.entries[0].id).toBe("c1");
  });
});
