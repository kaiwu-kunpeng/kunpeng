import { describe, expect, test } from "vitest";
import "../src/cli-commands/maintain-guardian.js";
import { listCliCommands } from "../src/cli-commands/registry.js";
import { buildGuardianReport } from "../src/loop/guardian-report.js";
import { cliSource } from "./helpers/cli-source.js";

describe("guardian-report cli wiring", () => {
  test("builds a report from reconcile findings", () => {
    const report = buildGuardianReport({
      ghostGates: ["g1"],
      orphanWorktrees: ["kp/x"],
      staleArtifacts: [],
      deadFlows: [],
    });

    expect(report.healthy).toBe(false);
    expect(report.totalFindings).toBe(2);
    expect(report.summary).toContain("幽灵合并门 1");
    expect(report.summary).toContain("孤儿worktree 1");
  });

  test("builds a healthy report for empty findings", () => {
    const report = buildGuardianReport({
      ghostGates: [],
      orphanWorktrees: [],
      staleArtifacts: [],
      deadFlows: [],
    });

    expect(report.healthy).toBe(true);
    expect(report.totalFindings).toBe(0);
    expect(report.summary).toContain("无异常");
  });

  test("cli contains guardian-report dispatch and reconcile wiring", () => {
    const cli = cliSource();

    expect(listCliCommands().map((command) => command.name)).toContain("guardian-report");
    expect(cli).toContain("buildGuardianReport");
    expect(cli).toContain("reconcileGhostMergeGates");
    expect(cli).toContain("reconcileOrphanWorktrees");
    expect(cli).toContain("reconcileStaleArtifacts");
    expect(cli).toContain("reconcileDeadFlows");
  });
});
