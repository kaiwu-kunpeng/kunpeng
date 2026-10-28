import { describe, it, expect } from "vitest";
import { parseAuditSummary, reductionOk, buildFixProvenance } from "../../src/security/audit-fix-outcome.js";

const AUDIT = JSON.stringify({ metadata: { vulnerabilities: { info: 0, low: 0, moderate: 5, high: 1, critical: 1, total: 7 } } });

describe("parseAuditSummary", () => {
  it("从 metadata.vulnerabilities 抽各严重度计数", () => {
    expect(parseAuditSummary(AUDIT)).toEqual({ critical: 1, high: 1, moderate: 5, low: 0, total: 7 });
  });
  it("坏 JSON / 无 metadata → 全 0", () => {
    expect(parseAuditSummary("xx")).toEqual({ critical: 0, high: 0, moderate: 0, low: 0, total: 0 });
    expect(parseAuditSummary("{}")).toEqual({ critical: 0, high: 0, moderate: 0, low: 0, total: 0 });
  });
});

describe("reductionOk", () => {
  it("总数降且高危没变多 → true", () => {
    const before = { critical: 1, high: 1, moderate: 5, low: 0, total: 7 };
    const after = { critical: 0, high: 1, moderate: 3, low: 0, total: 4 };
    expect(reductionOk(before, after)).toBe(true);
  });
  it("总数没降 → false", () => {
    const s = { critical: 0, high: 0, moderate: 2, low: 0, total: 2 };
    expect(reductionOk(s, s)).toBe(false);
  });
  it("总数降但 critical 变多 → false(拒绝)", () => {
    const before = { critical: 0, high: 0, moderate: 5, low: 0, total: 5 };
    const after = { critical: 2, high: 0, moderate: 0, low: 0, total: 2 };
    expect(reductionOk(before, after)).toBe(false);
  });
});

describe("buildFixProvenance", () => {
  it("组装 provenance 含 reduced", () => {
    const before = { critical: 1, high: 1, moderate: 5, low: 0, total: 7 };
    const after = { critical: 0, high: 0, moderate: 3, low: 0, total: 3 };
    const p = buildFixProvenance({ before, after, fixedPackages: ["bl", "semver"], verified: true, fixedAt: 1782530000000 });
    expect(p.reduced).toBe(4);
    expect(p.fixedPackages).toEqual(["bl", "semver"]);
    expect(p.verified).toBe(true);
    expect(p.fixedAt).toBe(1782530000000);
    expect(p.before.total).toBe(7);
    expect(p.after.total).toBe(3);
  });
});