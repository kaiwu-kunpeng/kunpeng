import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("提案采纳走 loop 的接线（作者锁定）", () => {
  const cli = readFileSync(new URL("../../src/cli-commands/maintain-guardian.ts", import.meta.url), "utf8");
  const live = readFileSync(new URL("../../src/evolution/apply-live.ts", import.meta.url), "utf8");

  it("apply 命令只有显式 --live 才直写宿主；maintain 每日尾部不传 live", () => {
    const applyIdx = cli.indexOf('name: "apply"');
    expect(applyIdx).toBeGreaterThan(-1);
    expect(cli.slice(applyIdx, applyIdx + 600)).toContain('live: context.flags.has("--live")');
    const maintainIdx = cli.indexOf('name: "maintain"');
    const maintainWindow = cli.slice(maintainIdx, applyIdx);
    expect(maintainWindow).toContain("runApplyApprovedLive(context.repoRoot, context.kunpengHome)");
    expect(maintainWindow).not.toMatch(/runApplyApprovedLive\([^)]*live:/);
  });

  it("apply-live 默认经 backlog 通道，compileAll 只在 live 下触发", () => {
    expect(live).toContain("backlogConventionsApplier");
    expect(live).toContain("conventionsLanded");
    expect(live).toContain("ReinjectStore");
    expect(live).toMatch(/live && report\.conventionsApplied > 0/);
  });
});