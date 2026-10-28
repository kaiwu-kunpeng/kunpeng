import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FitnessBaselineStore, ZERO_FITNESS } from "../../src/evolution/fitness-baseline.js";
import type { FitnessSnapshot } from "../../src/evolution/fitness.js";

let dirs: string[] = [];
function tmp(): string { const d = mkdtempSync(join(tmpdir(), "kp-fitbl-")); dirs.push(d); return d; }
afterEach(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); dirs = []; });

describe("FitnessBaselineStore", () => {
  it("save 后 load 取回同一快照（趋势 baseline 持久）", async () => {
    const store = new FitnessBaselineStore(join(tmp(), "fitness-baseline.json"));
    const snap: FitnessSnapshot = { netSavedHours: 846, verifiedDevFlows: 584, totalUsd: 12.4, totalTokens: 1000 };
    await store.save(snap);
    const back = await store.load();
    expect(back).toEqual(snap);
  });

  it("文件不存在 → load 返回 null（首轮无 baseline）", async () => {
    const store = new FitnessBaselineStore(join(tmp(), "nope.json"));
    expect(await store.load()).toBeNull();
  });

  it("ZERO_FITNESS 是全零对照起点", () => {
    expect(ZERO_FITNESS).toEqual({ netSavedHours: 0, verifiedDevFlows: 0, totalUsd: 0, totalTokens: 0 });
  });
});
