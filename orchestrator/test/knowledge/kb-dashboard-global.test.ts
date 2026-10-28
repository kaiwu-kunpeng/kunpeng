import { describe, it, expect } from "vitest";
import { buildKbResponse } from "../../src/knowledge/kb-index.js";
import type { Capture } from "../../src/knowledge/capture-store.js";

const cap = (id: string, summary: string, createdAt: number): Capture => ({
  id,
  source: "text",
  kind: "text",
  raw: summary,
  summary,
  tags: [],
  createdAt,
  promoted: false,
});

describe("buildKbResponse dashboard global knowledge pool", () => {
  it("includes global captures with stable global project identity", () => {
    const perProject = [{ projectId: "p1", projectName: "Project One", captures: [cap("local-1", "项目知识", 100)] }];
    const response = buildKbResponse(perProject, undefined, [cap("global-1", "全局知识", 200)]);

    const global = response.entries.find((entry) => entry.id === "global-1");
    expect(global?.projectId).toBe("global");
    expect(global?.projectName).toBe("全局知识池");
    expect(response.entries.map((entry) => entry.id)).toContain("local-1");
  });

  it("dedupes by id consistently with per-project entries winning first", () => {
    const perProject = [{ projectId: "p1", projectName: "Project One", captures: [cap("same", "项目版本", 100)] }];
    const response = buildKbResponse(perProject, undefined, [cap("same", "全局版本", 200)]);

    expect(response.entries.filter((entry) => entry.id === "same")).toHaveLength(1);
    expect(response.entries.find((entry) => entry.id === "same")?.projectId).toBe("p1");
  });
});
