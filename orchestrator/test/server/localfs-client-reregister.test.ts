import { describe, expect, it } from "vitest";

import { part04 } from "../../src/server/ui/client-parts/part04.js";

describe("localfs 前端周期性重报授权(serve 重启自愈)", () => {
  it("以时间戳节流重报,不再用一次性布尔标志", () => {
    expect(part04).toContain("localfsRegisteredAt");
    expect(part04).toMatch(/- localfsRegisteredAt < 60000/);
    expect(part04).not.toContain("localfsRegistered = true");
    expect(part04).not.toContain("var localfsRegistered = false");
  });

  it("重置点改为清零时间戳", () => {
    expect(part04).toMatch(/localfsRegisteredAt = 0/);
  });

  it("authorize 上报串保持不变", () => {
    expect(part04).toContain('fetch("/api/localfs/authorize?conv="');
  });
});