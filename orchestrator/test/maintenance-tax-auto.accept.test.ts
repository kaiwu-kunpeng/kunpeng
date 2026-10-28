import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordMaintenanceRun } from "../src/evolution/maintenance-run.js";
import { listMaintenance, maintenanceMinutes } from "../src/metrics/maintenance-ledger.js";

describe("维护税自动记账(作者验收)", () => {
  it("跑完自动写 ledger,分钟数按墙钟算且保留 1 位小数", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "kp-mtax-"));
    await mkdir(join(repoRoot, ".kunpeng", "state"), { recursive: true });
    const t0 = 1_000_000;
    recordMaintenanceRun(repoRoot, t0, { now: () => t0 + 90_000 });
    const stateDir = join(repoRoot, ".kunpeng", "state");
    const entries = listMaintenance(stateDir);
    expect(entries.length).toBe(1);
    expect(entries[0].minutes).toBe(1.5);
    expect(entries[0].what).toContain("maintain");
    expect(maintenanceMinutes(stateDir)).toBeGreaterThan(0);
  });

  it("目录不存在等异常静默吞掉,不抛", () => {
    expect(() => recordMaintenanceRun("/nonexistent/kp-nowhere", 0)).not.toThrow();
  });

  it("elapsed 为负按 0 分钟记,也留痕", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "kp-mtax2-"));
    await mkdir(join(repoRoot, ".kunpeng", "state"), { recursive: true });
    recordMaintenanceRun(repoRoot, 5_000, { now: () => 1_000 });
    const entries = listMaintenance(join(repoRoot, ".kunpeng", "state"));
    expect(entries.length).toBe(1);
    expect(entries[0].minutes).toBe(0);
  });
});