import { describe, it, expect } from "vitest";
import { parsePlaybook, PLAYBOOK_PHASES } from "../../src/loop/playbook.js";

const md = (phase: string) => `---
id: demo
phase: ${phase}
---
# 演示配方

## 检查节奏
每周。
`;

describe("playbook phase 字段", () => {
  it("PLAYBOOK_PHASES 恰为五段闭环且有序", () => {
    expect([...PLAYBOOK_PHASES]).toEqual(["research", "create", "distribute", "measure", "evolve"]);
  });

  it("合法 phase 全部解析进 PlaybookDef", () => {
    for (const phase of PLAYBOOK_PHASES) {
      expect(parsePlaybook(md(phase))!.phase).toBe(phase);
    }
  });

  it("非法与缺失 phase 都归 undefined（向后兼容）", () => {
    expect(parsePlaybook(md("banana"))!.phase).toBeUndefined();
    expect(parsePlaybook("# 无 frontmatter\n\n## 检查节奏\n每天。\n", "x")!.phase).toBeUndefined();
  });
});