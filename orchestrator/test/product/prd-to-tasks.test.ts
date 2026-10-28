import { describe, it, expect } from "vitest";
import { tasksFromPrd } from "../../src/product/prd-to-tasks.js";

describe("tasksFromPrd", () => {
  const prd = {
    title: "任务创建器",
    stories: [
      { title: "选择模板", acceptance: ["八类模板可选"] },
      { title: "缺失字段提示" },
    ],
  };
  it("每个 story 生成一条任务草稿", () => {
    const drafts = tasksFromPrd(prd);
    expect(drafts).toHaveLength(2);
    expect(drafts[0].title).toContain("选择模板");
    expect(drafts[0].acceptanceCriteria).toEqual(["八类模板可选"]);
    expect(drafts[1].acceptanceCriteria).toEqual([]);
  });
  it("草稿带 PRD 标题与统一类型", () => {
    const drafts = tasksFromPrd(prd);
    expect(drafts[0].title).toContain("任务创建器");
    expect(drafts.every((d) => d.type === "feature")).toBe(true);
  });
  it("空 stories 返回空数组", () => {
    expect(tasksFromPrd({ title: "x", stories: [] })).toEqual([]);
  });
});