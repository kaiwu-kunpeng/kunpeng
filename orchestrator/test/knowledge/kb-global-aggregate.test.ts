import { describe, it, expect } from "vitest";
import { aggregateCaptures } from "../../src/knowledge/kb-index.js";
import type { Capture } from "../../src/knowledge/capture-store.js";

const mk = (id: string, raw: string, extra: Partial<Capture> = {}): Capture => ({
  id, source: "text", kind: "text", raw, tags: [], createdAt: 1, promoted: false, ...extra,
});

describe("aggregateCaptures 纳入全局池", () => {
  it("项目 captures + 全局池都出现在结果里", () => {
    const perProject = [{ projectId: "acme-shop", projectName: "acme-shop", captures: [mk("p1", "项目知识")] }];
    const globalCaptures = [mk("g1", "全局通用知识", { sourceProfileId: "home" })];
    const out = aggregateCaptures(perProject, undefined, globalCaptures);
    const ids = out.map((e) => e.id);
    expect(ids).toContain("p1");
    expect(ids).toContain("g1");
  });
  it("不传 globalCaptures 行为不变(向后兼容)", () => {
    const perProject = [{ projectId: "acme-shop", projectName: "acme-shop", captures: [mk("p1", "x")] }];
    const out = aggregateCaptures(perProject);
    expect(out.map((e) => e.id)).toEqual(["p1"]);
  });
});
