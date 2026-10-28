import { describe, it, expect, vi } from "vitest";
import { recordLoopWave } from "./loop-core.js";

describe("recordLoopWave", () => {
  it("把波次同步追加进 ops 台账(熔断器读的就是它)", async () => {
    const appended: unknown[] = [];
    const store = {
      appendWave: vi.fn(async () => ({ seq: 7, at: 111, lever: "lv", subject: "s", metricDelta: 3, metricAfter: 9, verified: true })),
      read: vi.fn(async () => ({ id: "L", name: "n", projectId: "proj", recipe: "agent-playbook", metric: { key: "briefs", label: "简报数", current: 9 }, levers: [], waves: [], createdAt: 1, updatedAt: 1 })),
    };
    const tracker = { start: vi.fn(async () => {}), finish: vi.fn(async () => {}) };
    await recordLoopWave(
      { id: "L", lever: "lv", subject: "s", delta: 3, after: 9, verified: true },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { store: store as any, tracker: tracker as any, now: () => 111, stateDir: "/tmp/kp-test-state", appendAction: async (_dir: string, a: unknown) => { appended.push(a); } },
    );
    expect(appended).toHaveLength(1);
    const row = appended[0] as Record<string, unknown>;
    expect(row.loopId).toBe("L");
    expect(row.projectId).toBe("proj");
    expect(row.metricKey).toBe("briefs");
    expect(row.metricDelta).toBe(3);
    expect(row.metricAfter).toBe(9);
    expect(row.verified).toBe(true);
  });

  it("台账写失败不影响 record 成功返回", async () => {
    const store = {
      appendWave: vi.fn(async () => ({ seq: 1, at: 5, lever: "lv", subject: "s", metricDelta: 0, metricAfter: 0, verified: false })),
      read: vi.fn(async () => ({ id: "L", name: "n", projectId: "proj", recipe: "geo-monitor", metric: { key: "mentions", label: "提及", current: 0 }, levers: [], waves: [], createdAt: 1, updatedAt: 1 })),
    };
    const tracker = { start: vi.fn(async () => {}), finish: vi.fn(async () => {}) };
    const out = await recordLoopWave(
      { id: "L", lever: "lv", subject: "s", delta: 0, after: 0, verified: false },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { store: store as any, tracker: tracker as any, now: () => 5, stateDir: "/tmp/kp-test-state", appendAction: async () => { throw new Error("disk full"); } },
    );
    expect(out.wave.seq).toBe(1);
    expect(out.flowId).toBe("loop-L-w1");
  });
});