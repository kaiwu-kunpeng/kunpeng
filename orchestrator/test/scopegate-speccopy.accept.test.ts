import { describe, expect, it } from "vitest";
import { isMachineSpecCopy, planScopeViolations } from "../src/plan/orchestrator.js";

const SPEC = "```scope\nallow: orchestrator/src/agent/model-routing.ts\n```\n\n# f\n\n要求\n\n```accept\necho ok\n```\n";

describe("范围门豁免机器spec副本(作者验收)", () => {
  it("spec 副本形态豁免,其他不豁免", () => {
    expect(isMachineSpecCopy("orchestrator/specs/某某方案.spec.md")).toBe(true);
    expect(isMachineSpecCopy("orchestrator/specs/x.spec.html")).toBe(true);
    expect(isMachineSpecCopy("orchestrator/specs/x.md")).toBe(false);
    expect(isMachineSpecCopy("orchestrator/src/specs/x.spec.md")).toBe(false);
    expect(isMachineSpecCopy("specs/x.spec.md")).toBe(false);
  });

  it("planScopeViolations 不再把 spec 副本判违规,真越界照拦", () => {
    const v = planScopeViolations(SPEC, [
      "orchestrator/specs/提案管道语义修正.spec.md",
      "orchestrator/specs/提案管道语义修正.spec.html",
      "orchestrator/src/server/http.ts",
    ]);
    expect(v.length).toBe(1);
    expect(v[0].file).toBe("orchestrator/src/server/http.ts");
  });
});