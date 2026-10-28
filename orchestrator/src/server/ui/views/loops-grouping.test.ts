import { describe, expect, it } from "vitest";
import { groupByProject } from "./loops.js";

describe("groupByProject", () => {
  it("按项目分组:组间按条数降序,同数按 projectId 字典序,组内保序", () => {
    const groups = groupByProject([
      { projectId: "b", id: 1 },
      { projectId: "a", id: 2 },
      { projectId: "b", id: 3 },
      { projectId: "c", id: 4 },
    ] as Array<{ projectId?: string; id: number }>);
    expect(groups.map((g) => g.projectId)).toEqual(["b", "a", "c"]);
    expect(groups[0].items.map((i) => (i as { id: number }).id)).toEqual([1, 3]);
  });

  it("缺省 projectId 归入 未归属", () => {
    const groups = groupByProject([{ id: 1 }, { projectId: "x", id: 2 }] as Array<{ projectId?: string; id: number }>);
    const names = groups.map((g) => g.projectId);
    expect(names).toContain("未归属");
    expect(names).toContain("x");
  });

  it("空数组返回空", () => {
    expect(groupByProject([])).toEqual([]);
  });
});