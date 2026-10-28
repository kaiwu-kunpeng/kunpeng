import { describe, expect, test } from "vitest";
import { classifyComplexity } from "../../src/loop/complexity.js";

describe("classifyComplexity", () => {
  test("短单点需求→simple", () => {
    const verdict = classifyComplexity("给 add 函数加一个入参校验");

    expect(verdict.complexity).toBe("simple");
    expect(verdict.score).toBeLessThan(2);
    expect(verdict.reasons.length).toBeGreaterThan(0);
  });

  test("含复杂关键词→complex", () => {
    const verdict = classifyComplexity("重构登录流程并迁移认证架构");

    expect(verdict.complexity).toBe("complex");
    expect(verdict.reasons.join("\n")).toContain("重构");
    expect(verdict.reasons.length).toBeGreaterThan(0);
  });

  test("fileHint>1→complex", () => {
    const verdict = classifyComplexity("改个小东西", { fileHint: 3 });

    expect(verdict.complexity).toBe("complex");
    expect(verdict.reasons.join("\n")).toContain("3 个文件");
    expect(verdict.reasons.length).toBeGreaterThan(0);
  });

  test("多子句堆叠→complex", () => {
    const verdict = classifyComplexity("改按钮文案，补空态提示，调整排序，更新测试");

    expect(verdict.complexity).toBe("complex");
    expect(verdict.reasons.join("\n")).toContain("多子句(4段)");
    expect(verdict.reasons.length).toBeGreaterThan(0);
  });

  test("长需求加分", () => {
    const requirement = "请调整提示文案让表达更清楚且保持当前行为不变".repeat(16);
    const verdict = classifyComplexity(requirement);

    expect(requirement.length).toBeGreaterThan(280);
    expect(verdict.complexity).toBe("complex");
    expect(verdict.reasons.length).toBeGreaterThan(0);
  });
});
