import { describe, expect, it } from "vitest";
import { isAgentRegistryFile, planScopeViolations } from "../src/plan/orchestrator.js";

describe("范围门豁免登记文件(作者验收)", () => {
  it("识别任意层级 AGENTS-ACTIVE.md", () => {
    expect(isAgentRegistryFile("AGENTS-ACTIVE.md")).toBe(true);
    expect(isAgentRegistryFile("orchestrator/AGENTS-ACTIVE.md")).toBe(true);
    expect(isAgentRegistryFile("a/b/AGENTS-ACTIVE.md")).toBe(true);
    expect(isAgentRegistryFile("AGENTS.md")).toBe(false);
    expect(isAgentRegistryFile("src/AGENTS-ACTIVE.md.ts")).toBe(false);
  });
  it("范围门不再把登记文件判越界", () => {
    const spec = "```scope\nallow: orchestrator/src/a.ts\n```\n\n# 测试段\n正文";
    const violations = planScopeViolations(spec, ["orchestrator/src/a.ts", "orchestrator/AGENTS-ACTIVE.md"]);
    expect(violations.some((v) => v.file.includes("AGENTS-ACTIVE"))).toBe(false);
  });
});