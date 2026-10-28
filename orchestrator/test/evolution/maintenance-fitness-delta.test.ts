import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMaintenanceLive } from "../../src/evolution/maintenance-run.js";
import type { FitnessSnapshot } from "../../src/evolution/fitness.js";

let dirs: string[] = [];
function tmp(): string { const d = mkdtempSync(join(tmpdir(), "kp-fitdelta-")); dirs.push(d); return d; }
afterEach(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); dirs = []; });

describe("maintain 真适应度趋势 Δ（E0③）", () => {
  it("当前 vs 注入 baseline → result.fitnessDelta 算出真 Δ + improved", async () => {
    const baseline: FitnessSnapshot = { netSavedHours: 40, verifiedDevFlows: 3, totalUsd: 0, totalTokens: 0 };
    const current: FitnessSnapshot = { netSavedHours: 53, verifiedDevFlows: 3, totalUsd: 0, totalTokens: 0 };
    const saved: FitnessSnapshot[] = [];
    const r = await runMaintenanceLive(tmp(), {
      auditJson: async () => "{}",
      moduleStatuses: async () => [],
      fitnessSnapshot: async () => current,
      loadBaseline: async () => baseline,
      saveBaseline: async (s) => { saved.push(s); },
    });
    expect(r.fitnessDelta?.netSavedHoursDelta).toBe(13); // 53 - 40
    expect(r.fitnessDelta?.improved).toBe(true); // 净省工时↑ 且无回归
    // 当前快照被存为新 baseline（下一轮的对照）
    expect(saved.at(-1)).toEqual(current);
  });

  it("净省工时下降 → improved=false（非回归门拦）", async () => {
    const r = await runMaintenanceLive(tmp(), {
      auditJson: async () => "{}",
      moduleStatuses: async () => [],
      fitnessSnapshot: async () => ({ netSavedHours: 30, verifiedDevFlows: 3, totalUsd: 0, totalTokens: 0 }),
      loadBaseline: async () => ({ netSavedHours: 40, verifiedDevFlows: 3, totalUsd: 0, totalTokens: 0 }),
      saveBaseline: async () => {},
    });
    expect(r.fitnessDelta?.netSavedHoursDelta).toBe(-10);
    expect(r.fitnessDelta?.improved).toBe(false);
  });
});
