import { describe, it, expect } from "vitest";
import { perfHealthSnapshot } from "../../src/server/perf-health.js";

describe("perfHealthSnapshot", () => {
  it("全部指标达标时 ok 且无告警", () => {
    const s = perfHealthSnapshot({ stateCollectMs: 120, eventLoopDelayMs: 20, slowRequests: [] });
    expect(s.ok).toBe(true);
    expect(s.warnings).toHaveLength(0);
  });
  it("状态采集超 1000ms 产生告警", () => {
    const s = perfHealthSnapshot({ stateCollectMs: 2400 });
    expect(s.ok).toBe(false);
    expect(s.warnings.join()).toContain("状态采集");
  });
  it("事件循环延迟超 200ms 产生告警", () => {
    const s = perfHealthSnapshot({ eventLoopDelayMs: 350 });
    expect(s.warnings.join()).toContain("事件循环");
  });
  it("慢请求逐条点名", () => {
    const s = perfHealthSnapshot({ slowRequests: [{ path: "/api/state", ms: 900 }] });
    expect(s.warnings.join()).toContain("/api/state");
  });
});