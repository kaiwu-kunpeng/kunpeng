import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderInsights } from "../../src/server/ui/views/insights.js";

describe("洞察页回滚热图（作者锁定）", () => {
  it("有热图数据 → 表格含覆盖率、kind 行、stage 列与后端汇总", () => {
    const html = renderInsights({
      rollbackHeatmap: {
        cells: [
          { kind: "test-failed", stage: "verify", backend: "codex", count: 3, flowIds: ["a", "b", "c"] },
          { kind: "worktree-contention", stage: "spec", backend: "unknown", count: 1, flowIds: ["d"] },
        ],
        kinds: ["test-failed", "worktree-contention"],
        stages: ["spec", "verify"],
        backends: ["codex", "unknown"],
        coverage: { total: 5, attributed: 4, unknown: 1, pct: 80 },
      },
    } as never);
    expect(html).toContain("回滚热图");
    expect(html).toContain("覆盖率 80%");
    expect(html).toContain("4/5");
    expect(html).toContain("test-failed");
    expect(html).toContain("worktree-contention");
    expect(html).toContain("codex=3");
    expect(html).toContain("<table");
    expect(html).not.toMatch(/style="/);
    expect(html).not.toMatch(/#[0-9a-fA-F]{6}\b/);
  });

  it("没有数据 → 暂无回滚，不渲染表格", () => {
    const html = renderInsights({} as never);
    expect(html).toContain("暂无回滚");
    expect(renderInsights({ rollbackHeatmap: { cells: [], kinds: [], stages: [], backends: [], coverage: { total: 0, attributed: 0, unknown: 0, pct: 0 } } } as never)).toContain("暂无回滚");
  });

  it("CLI 与采集器接线", () => {
    const reports = readFileSync(new URL("../../src/cli-commands/reports.ts", import.meta.url), "utf8");
    expect(reports).toContain("--heatmap");
    expect(reports).toContain("--backfill");
    expect(reports).toContain("--dry-run");
    expect(reports).toContain("backfillRollbackAttribution(");
    expect(reports).toContain("renderHeatmapText(");
    const dashboard = readFileSync(new URL("../../src/server/state-collect/dashboard.ts", import.meta.url), "utf8");
    expect(dashboard).toContain("buildRollbackHeatmap(");
    expect(dashboard).toContain("rollbackHeatmap");
  });
});