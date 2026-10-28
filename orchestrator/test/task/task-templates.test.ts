import { describe, it, expect } from "vitest";
import { validateTaskDraft } from "../../src/task/templates.js";

describe("validateTaskDraft", () => {
  const good = { type: "feature", title: "任务创建器", goal: "把启动新工作从 prompt 换成结构化表单", acceptanceCriteria: ["表单必填校验生效"] };
  it("完整草稿通过", () => {
    expect(validateTaskDraft(good).ok).toBe(true);
  });
  it("缺验收标准不通过且指明问题", () => {
    const v = validateTaskDraft({ ...good, acceptanceCriteria: [] });
    expect(v.ok).toBe(false);
    expect(v.problems.join()).toContain("验收");
  });
  it("目标太短判太模糊", () => {
    const v = validateTaskDraft({ ...good, goal: "改一下" });
    expect(v.ok).toBe(false);
    expect(v.problems.join()).toContain("模糊");
  });
});
