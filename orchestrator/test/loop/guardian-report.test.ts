import { describe, expect, test } from "vitest";
import { buildGuardianReport, type GuardianFindings } from "../../src/loop/guardian-report.js";

const SECTION_NAMES = ["死流", "陈旧产物", "幽灵合并门", "孤儿worktree"];

describe("buildGuardianReport", () => {
  test("builds a healthy report for empty findings", () => {
    const report = buildGuardianReport({});

    expect(report.healthy).toBe(true);
    expect(report.totalFindings).toBe(0);
    expect(report.summary).toContain("无异常");
    expect(report.sections).toHaveLength(4);
    expect(report.sections.map((section) => section.name)).toEqual(SECTION_NAMES);
    expect(report.sections.map((section) => section.count)).toEqual([0, 0, 0, 0]);
    expect(report.sections.map((section) => section.items)).toEqual([[], [], [], []]);
  });

  test("counts partial findings and summarizes non-empty sections", () => {
    const report = buildGuardianReport({
      deadFlows: ["f1"],
      ghostGates: ["g1", "g2"],
    });

    expect(report.healthy).toBe(false);
    expect(report.totalFindings).toBe(3);
    expect(report.sections.map((section) => section.name)).toEqual(SECTION_NAMES);
    expect(report.sections[0]).toEqual({ name: "死流", count: 1, items: ["f1"] });
    expect(report.sections[1]).toEqual({ name: "陈旧产物", count: 0, items: [] });
    expect(report.sections[2]).toEqual({ name: "幽灵合并门", count: 2, items: ["g1", "g2"] });
    expect(report.sections[3]).toEqual({ name: "孤儿worktree", count: 0, items: [] });
    expect(report.summary).toContain("死流");
    expect(report.summary).toContain("1");
    expect(report.summary).toContain("幽灵合并门");
    expect(report.summary).toContain("2");
  });

  test("does not mutate input and keeps returned items detached", () => {
    const findings: GuardianFindings = {
      deadFlows: ["f1"],
      staleArtifacts: ["a1"],
      ghostGates: ["g1"],
      orphanWorktrees: ["w1"],
    };
    const before = structuredClone(findings);

    const report = buildGuardianReport(findings);

    expect(findings).toEqual(before);
    report.sections[0].items.push("mutated");
    expect(findings.deadFlows).toEqual(["f1"]);
    expect(report.sections.map((section) => section.name)).toEqual(SECTION_NAMES);
    expect(buildGuardianReport({}).sections.map((section) => section.name)).toEqual(SECTION_NAMES);
  });
});
