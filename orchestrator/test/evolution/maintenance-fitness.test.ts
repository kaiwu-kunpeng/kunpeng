import { describe, it, expect } from "vitest";
import { runMaintenanceScan } from "../../src/evolution/maintenance-scan.js";
import type { FitnessSnapshot } from "../../src/evolution/fitness.js";
import type { ArtifactStore } from "../../src/artifacts/store.js";
import type { CaptureStore } from "../../src/knowledge/capture-store.js";

function fakeStore(): ArtifactStore & { writes: unknown[] } {
  const writes: unknown[] = [];
  return {
    writes,
    write: async (artifact: unknown) => { writes.push(artifact); },
  } as unknown as ArtifactStore & { writes: unknown[] };
}
function fakeCaptures(): CaptureStore & { caps: unknown[] } {
  const caps: unknown[] = [];
  return {
    caps,
    appendCapture: async (capture: unknown) => { caps.push(capture); return true; },
  } as unknown as CaptureStore & { caps: unknown[] };
}

describe("maintain scan 接真适应度（result surface，不碰 capture 计数器）", () => {
  it("传入 fitnessSnapshot → result.fitness 有值", async () => {
    const snap: FitnessSnapshot = { netSavedHours: 53.2, verifiedDevFlows: 3, totalUsd: 0, totalTokens: 1200 };
    const res = await runMaintenanceScan({
      store: fakeStore(),
      captures: fakeCaptures(),
      auditJson: async () => "{}",
      moduleStatuses: async () => [],
      now: () => 1,
      id: () => "mr-x",
      fitnessSnapshot: async () => snap,
    });
    expect(res.fitness?.netSavedHours).toBe(53.2);
    // 不变式：scan 不因 fitness 多写 capture（per-proposal 计数器不动）
    expect(res.capturesWritten).toBe(res.selected);
  });

  it("不传 fitnessSnapshot → 向后兼容，res.fitness 为 undefined", async () => {
    const res = await runMaintenanceScan({
      store: fakeStore(),
      captures: fakeCaptures(),
      auditJson: async () => "{}",
      moduleStatuses: async () => [],
      now: () => 1,
      id: () => "mr-y",
    });
    expect(res.fitness).toBeUndefined();
  });
});
