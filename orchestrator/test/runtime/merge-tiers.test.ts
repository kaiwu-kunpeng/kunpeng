import { describe, expect, it } from "vitest";
import {
  MERGE_TIER_LARGE_DIFF_FILES,
  MERGE_TIER_RULES,
  decideMergeTier,
  formatMergeTierLine,
  resolveMergeTierMode,
  type MergeTierInput,
} from "../../src/runtime/merge-tiers.js";

const clean: MergeTierInput = {
  flowId: "f",
  changedFiles: ["orchestrator/src/metrics/x.ts", "orchestrator/test/metrics/x.test.ts"],
  sensitiveHits: [],
  publicSurfaceTouched: false,
  preReviewVerdict: "approve",
  redFirst: true,
  changedFileCount: 2,
  guardStatus: "pending",
};

describe("分级规则表（作者锁定）", () => {
  it("规则顺序与 id 固定", () => {
    expect(MERGE_TIER_RULES.map((r) => r.id)).toEqual([
      "sensitive-path", "public-surface", "pre-review-reject", "guard-red",
      "baseline-green", "no-red-first-evidence", "empty-diff", "large-diff",
    ]);
    expect(MERGE_TIER_LARGE_DIFF_FILES).toBe(40);
  });

  it("干净输入 → auto，无理由", () => {
    expect(decideMergeTier(clean)).toEqual({ tier: "auto", reasons: [], ruleIds: [] });
  });

  it("单条命中各给出对应 ruleId", () => {
    expect(decideMergeTier({ ...clean, sensitiveHits: [{ file: "constitution/core.md", label: "宪法与角色卡" }] }).ruleIds).toEqual(["sensitive-path"]);
    expect(decideMergeTier({ ...clean, publicSurfaceTouched: true }).ruleIds).toEqual(["public-surface"]);
    expect(decideMergeTier({ ...clean, preReviewVerdict: "reject" }).ruleIds).toEqual(["pre-review-reject"]);
    expect(decideMergeTier({ ...clean, guardStatus: "red" }).ruleIds).toEqual(["guard-red"]);
    expect(decideMergeTier({ ...clean, redFirst: undefined, baselineGreen: true }).ruleIds).toEqual(["baseline-green"]);
    expect(decideMergeTier({ ...clean, redFirst: undefined }).ruleIds).toEqual(["no-red-first-evidence"]);
    expect(decideMergeTier({ ...clean, changedFileCount: 0 }).ruleIds).toEqual(["empty-diff"]);
    expect(decideMergeTier({ ...clean, changedFileCount: 41 }).ruleIds).toEqual(["large-diff"]);
    expect(decideMergeTier({ ...clean, changedFileCount: 40 }).tier).toBe("auto");
    expect(decideMergeTier({ ...clean, guardStatus: "skipped" }).tier).toBe("auto");
  });

  it("多条命中全部收集、tier=human、理由可读", () => {
    const v = decideMergeTier({ ...clean, sensitiveHits: [{ file: "orchestrator/src/server/authz.ts", label: "鉴权/授权" }], changedFileCount: 99 });
    expect(v.tier).toBe("human");
    expect(v.ruleIds).toEqual(["sensitive-path", "large-diff"]);
    expect(v.reasons[0]).toContain("鉴权/授权");
    expect(v.reasons[1]).toContain("99");
  });

  it("模式：只有 enforce 才拦，其它一律 report；日志行含 flow 与 tier", () => {
    expect(resolveMergeTierMode({})).toBe("report");
    expect(resolveMergeTierMode({ KUNPENG_MERGE_TIERS: " Enforce " })).toBe("enforce");
    expect(resolveMergeTierMode({ KUNPENG_MERGE_TIERS: "1" })).toBe("report");
    const line = formatMergeTierLine("f9", { tier: "human", reasons: ["改动为空"], ruleIds: ["empty-diff"] }, "report");
    expect(line).toContain("f9");
    expect(line).toContain("tier=human");
    expect(line).toContain("只报不判");
    expect(line).toContain("改动为空");
    expect(formatMergeTierLine("f9", { tier: "auto", reasons: [], ruleIds: [] }, "enforce")).toContain("拦");
  });
});