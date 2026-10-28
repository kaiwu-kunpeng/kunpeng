import { describe, expect, it } from "vitest";
import { planScopeViolations } from "../src/plan/orchestrator.js";

const FENCE = "`".repeat(3);
const spec = FENCE + "scope\nallow: orchestrator/src/a.ts\n" + FENCE + "\n# t\n";

describe("spec 副本豁免只认 orchestrator/specs(作者验收)", () => {
  it("orchestrator/specs 机器副本豁免", () => {
    expect(planScopeViolations(spec, ["orchestrator/specs/x.spec.md"])).toEqual([]);
  });
  it("docs/specs、深层与他处都不豁免", () => {
    expect(planScopeViolations(spec, ["docs/specs/2026-07-11-x.md"]).length).toBe(1);
    expect(planScopeViolations(spec, ["docs/specs/deep/x.md"]).length).toBe(1);
    expect(planScopeViolations(spec, ["docs/x.md"]).length).toBe(1);
    expect(planScopeViolations(spec, ["orchestrator/src/b.ts"]).length).toBe(1);
  });
});