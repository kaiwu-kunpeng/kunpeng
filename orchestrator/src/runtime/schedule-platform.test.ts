import { describe, it, expect } from "vitest";
import { renderScheduleHint } from "./daemon-schedule.js";

describe("renderScheduleHint", () => {
  it("systemd 平台给出 timer/service 指引", () => {
    const out = renderScheduleHint({ platform: "systemd", intervalMinutes: 30, command: "/usr/bin/node /opt/kunpeng/cli.js patrol --repo /srv/app", label: "kunpeng-patrol" });
    expect(out).toMatch(/systemctl/);
    expect(out).toMatch(/\[Timer\]|OnUnitActiveSec/);
  });
  it("launchd 平台至少给出 crontab 行", () => {
    const out = renderScheduleHint({ platform: "launchd", intervalMinutes: 15, command: "/usr/bin/node cli.js ops --repo /x", label: "kunpeng-ops" });
    expect(out).toMatch(/\*\/15 \* \* \* \*/);
  });
  it("unsupported 平台回退 crontab", () => {
    const out = renderScheduleHint({ platform: "unsupported", intervalMinutes: 5, command: "/usr/bin/node cli.js patrol", label: "kunpeng-patrol" });
    expect(out).toMatch(/\*\/5 \* \* \* \*/);
  });
  it("是纯函数,同入参恒等输出", () => {
    const a = renderScheduleHint({ platform: "systemd", intervalMinutes: 10, command: "c", label: "l" });
    const b = renderScheduleHint({ platform: "systemd", intervalMinutes: 10, command: "c", label: "l" });
    expect(a).toBe(b);
  });
});