import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMaintenanceLive } from "../../src/evolution/maintenance-run.js";
import type { FitnessSnapshot } from "../../src/evolution/fitness.js";
import type { ProductKpiSnapshot } from "../../src/evolution/product-kpi.js";

let dirs: string[] = [];
function tmp(): string { const d = mkdtempSync(join(tmpdir(), "kp-mkpi-")); dirs.push(d); return d; }
afterEach(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); dirs = []; });

const kpi = (value: number): ProductKpiSnapshot => ({ key: "autonomy", label: "自主度", value, higherBetter: true });
const fit = (h: number): FitnessSnapshot => ({ netSavedHours: h, verifiedDevFlows: 3, totalUsd: 0, totalTokens: 0 });

describe("maintain B 维（接产品）", () => {
  it("注入 kpiProvider+baseline → result.kpiDelta 真算出 + B-baseline 被更新", async () => {
    const saved: ProductKpiSnapshot[] = [];
    const r = await runMaintenanceLive(tmp(), {
      auditJson: async () => "{}",
      moduleStatuses: async () => [],
      fitnessSnapshot: async () => fit(53),
      loadBaseline: async () => fit(40),
      saveBaseline: async () => {},
      kpiProvider: async () => kpi(0.9),
      loadKpiBaseline: async () => kpi(0.8),
      saveKpiBaseline: async (s) => { saved.push(s); },
    });
    expect(r.kpiDelta?.key).toBe("autonomy");
    expect(r.kpiDelta?.valueDelta).toBeCloseTo(0.1, 6); // 0.9 - 0.8
    expect(r.kpiDelta?.improved).toBe(true); // higherBetter ∧ Δ>0
    expect(saved.at(-1)?.value).toBe(0.9); // 当前快照存为新 baseline
  });

  it("A 不退化(净省工时↑) ∧ B 改进 → 落 progress 合并裁决 capture", async () => {
    const dir = tmp();
    const r = await runMaintenanceLive(dir, {
      auditJson: async () => "{}",
      moduleStatuses: async () => [],
      fitnessSnapshot: async () => fit(53),
      loadBaseline: async () => fit(40),     // A: 40→53，Δ+13，不退化
      saveBaseline: async () => {},
      kpiProvider: async () => kpi(0.9),
      loadKpiBaseline: async () => kpi(0.8), // B: 0.8→0.9，改进
      saveKpiBaseline: async () => {},
    });
    expect(r.kpiDelta?.improved).toBe(true);
    // 合并裁决 capture 真落知识库（kind=self-evo-combined-verdict，含"真进步"）
    const capRoot = join(dir, ".kunpeng", "captures");
    const fs = readFileSync;
    const { readdirSync } = await import("node:fs");
    const files = readdirSync(capRoot);
    const hit = files.some((f) => {
      try { const c = JSON.parse(fs(join(capRoot, f), "utf8")); return c.kind === "self-evo-combined-verdict" && String(c.raw).includes("真进步"); } catch { return false; }
    });
    expect(hit).toBe(true);
  });
});
