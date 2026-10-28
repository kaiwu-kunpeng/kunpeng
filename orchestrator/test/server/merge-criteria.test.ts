import { describe, expect, it } from "vitest";
import {
  MERGE_CRITERIA_LABEL,
  MERGE_DIFF_TRUNCATED_NOTICE,
  extractAcceptanceCriteria,
  preReviewMerge,
} from "../../src/server/pre-review.js";

// 夹具全部取自 .kunpeng/artifacts/ 里真实 spec 产物的形态（共 9 种变体，此处覆盖主要几种）
const REAL_H2 = [
  "# 某个 spec",
  "",
  "## 实现要求",
  "- 随便写点什么",
  "",
  "## 验收标准（可客观判定）",
  "1. `stage-report.test.ts` 存在，且 `stage-report.ts` 含 `buildStageCostRows`。",
  "2. `flow-metrics.ts` 含 `isAggregateFlowId`。",
  "3. 全量 `tsc --noEmit` 通过。",
  "",
  "## 之后的无关章节",
  "不该被吞进来",
].join("\n");

const REAL_BOLD = [
  "**目标**",
  "- 做某件事",
  "",
  "**验收标准**",
  "- 第一条",
  "- 第二条",
  "",
  "**约束**",
  "不该被吞进来",
].join("\n");

const REAL_H3_SUFFIX = [
  "### 验收标准（客观可判定）",
  "- 甲",
  "```accept",
  "不该被吞进来",
  "```",
].join("\n");

const REAL_ALT_WORDING = [
  "**验收测试（作者亲写，锁定落盘）**",
  "- 锁定的断言若干",
  "",
  "**约束**",
  "尾巴",
].join("\n");

describe("extractAcceptanceCriteria", () => {
  it("认得带后缀的二级标题并抽出正文", () => {
    const out = extractAcceptanceCriteria(REAL_H2);
    expect(out).toContain("验收标准（可客观判定）");
    expect(out).toContain("isAggregateFlowId");
    expect(out).not.toContain("不该被吞进来");
    expect(out).not.toContain("随便写点什么");
  });

  it("粗体独占行不会被它自身立即终止", () => {
    const out = extractAcceptanceCriteria(REAL_BOLD);
    expect(out).toContain("第一条");
    expect(out).toContain("第二条");
    expect(out).not.toContain("不该被吞进来");
  });

  it("三级标题带后缀也认得，且遇到围栏即停", () => {
    const out = extractAcceptanceCriteria(REAL_H3_SUFFIX);
    expect(out).toContain("甲");
    expect(out).not.toContain("不该被吞进来");
  });

  it("判据是「去掉 #/*/空白后以验收开头」，不是固定字面量", () => {
    const out = extractAcceptanceCriteria(REAL_ALT_WORDING);
    expect(out).toContain("锁定的断言若干");
    expect(out).not.toContain("尾巴");
  });

  it("抽不到时回落到 testCmd", () => {
    const out = extractAcceptanceCriteria("# 没有验收段\n随便什么", "cd orchestrator && npx tsc --noEmit");
    expect(out).toContain("cd orchestrator && npx tsc --noEmit");
  });

  it("抽不到且无 testCmd 时返回空串", () => {
    expect(extractAcceptanceCriteria("# 没有那一段\n正文")).toBe("");
  });

  it("空输入返回空串且不抛", () => {
    expect(extractAcceptanceCriteria("")).toBe("");
  });

  it("结果不超过 4000 字符", () => {
    const huge = "## 验收标准\n" + "- 很长的一条\n".repeat(3000);
    expect(extractAcceptanceCriteria(huge).length).toBeLessThanOrEqual(4000);
  });
});

function spyRunner(text: string) {
  const systems: string[] = [];
  const runner = {
    run: async (req: { system: string }) => {
      systems.push(req.system);
      return { text };
    },
  } as unknown as Parameters<typeof preReviewMerge>[1];
  return { runner, systems };
}

const OK = '{"verdict":"approve","reason":"改动小"}';

describe("preReviewMerge 接收验收标准", () => {
  it("传入 criteria 时提示词含标签与正文", async () => {
    const { runner, systems } = spyRunner(OK);
    await preReviewMerge("diff --git a b\n+x\n", runner, () => 1, "- 必须防护 undefined");
    expect(systems[0]).toContain(MERGE_CRITERIA_LABEL);
    expect(systems[0]).toContain("必须防护 undefined");
  });

  it("不传 criteria 时提示词不混入标签（既有行为逐字不变）", async () => {
    const { runner, systems } = spyRunner(OK);
    await preReviewMerge("diff --git a b\n+x\n", runner, () => 1);
    expect(systems[0]).not.toContain(MERGE_CRITERIA_LABEL);
  });

  it("传空串等同于不传", async () => {
    const { runner, systems } = spyRunner(OK);
    await preReviewMerge("diff --git a b\n+x\n", runner, () => 1, "");
    expect(systems[0]).not.toContain(MERGE_CRITERIA_LABEL);
  });

  it("超长 diff 与 criteria 并存时两段都在", async () => {
    const huge = "diff --git a b\n" + "+x\n".repeat(40_000);
    const { runner, systems } = spyRunner(OK);
    await preReviewMerge(huge, runner, () => 1, "- 某条验收");
    expect(systems[0]).toContain(MERGE_DIFF_TRUNCATED_NOTICE);
    expect(systems[0]).toContain(MERGE_CRITERIA_LABEL);
    expect(systems[0]).toContain("某条验收");
  });

  it("传 criteria 不改变判决本身（仍按模型输出解析）", async () => {
    const { runner } = spyRunner('{"verdict":"reject","reason":"有洞"}');
    const pr = await preReviewMerge("diff --git a b\n+x\n", runner, () => 1, "- 某条");
    expect(pr.verdict).toBe("reject");
  });
});