import { describe, it, expect } from "vitest";
import { isServeOnline, serveHeartbeatFile } from "../../src/status/serve-heartbeat.js";

describe("isServeOnline", () => {
  it("窗口内 → 在线", () => {
    expect(isServeOnline({ ts: 1000 }, 1000)).toBe(true);
    expect(isServeOnline({ ts: 1000 }, 1000 + 89000)).toBe(true);
  });
  it("超窗/空/未来时间 → 离线", () => {
    expect(isServeOnline({ ts: 1000 }, 1000 + 200000)).toBe(false);
    expect(isServeOnline(null, 5)).toBe(false);
    expect(isServeOnline({ ts: 5000 }, 1000)).toBe(false);
  });
});

describe("serveHeartbeatFile", () => {
  it("落在 stateDir 下", () => {
    expect(serveHeartbeatFile("/x/state")).toContain("serve-heartbeat.json");
  });
});