import { describe, expect, it } from "vitest";
import { planScopeViolations } from "../../src/plan/orchestrator.js";
import { evaluateScopeOnMainPath, isMachineSpecCopy } from "../../src/verify/scope-main-gate.js";

const FENCE = "`".repeat(3);
const ALLOW_SRC = { allow: ["orchestrator/src/**"], forbid: [] };

describe("范围门不再豁免 docs/specs 下的文件（作者锁定）", () => {
  it("docs/specs 下的 md/html 不算机器副本；orchestrator/specs 的 .spec.md 仍算", () => {
    expect(isMachineSpecCopy("docs/specs/2026-09-28-test-typecheck-cleanup.md")).toBe(false);
    expect(isMachineSpecCopy("docs/specs/x.html")).toBe(false);
    expect(isMachineSpecCopy("orchestrator/specs/x.spec.md")).toBe(true);
    expect(isMachineSpecCopy("orchestrator/specs/x.spec.html")).toBe(true);
  });

  it("流在 docs/specs 多写一份 spec 副本 → 主路径范围门判越界并点名该文件", () => {
    const v = evaluateScopeOnMainPath(
      ["orchestrator/src/a.ts", "docs/specs/2026-09-28-test-typecheck-cleanup.md"],
      ALLOW_SRC,
      { requireScope: true },
    );
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.reason).toBe("drift");
      expect(v.violations.map((x) => x.file)).toEqual(["docs/specs/2026-09-28-test-typecheck-cleanup.md"]);
    }
  });

  it("spec 在 scope 里显式放行 docs/specs → 不算越界", () => {
    const v = evaluateScopeOnMainPath(
      ["orchestrator/src/a.ts", "docs/specs/x.md"],
      { allow: ["orchestrator/src/**", "docs/specs/**"], forbid: [] },
      { requireScope: true },
    );
    expect(v.ok).toBe(true);
  });

  it("plan 路径同样判越界", () => {
    const spec = FENCE + "scope\nallow: orchestrator/src/**\n" + FENCE + "\n# t\n";
    expect(planScopeViolations(spec, ["docs/specs/x.md"]).map((x) => x.file)).toEqual(["docs/specs/x.md"]);
    expect(planScopeViolations(spec, ["orchestrator/specs/x.spec.md"])).toEqual([]);
  });
});