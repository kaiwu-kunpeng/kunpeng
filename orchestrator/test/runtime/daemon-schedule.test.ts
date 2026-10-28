import { describe, it, expect } from "vitest";
import {
  daemonPlatform, systemdUnitName, renderSystemdService, renderSystemdTimer,
  installDaemonSchedule, uninstallDaemonSchedule, type DaemonIo, type DaemonScheduleSpec,
} from "../../src/runtime/daemon-schedule.js";

function fakeIo(): DaemonIo & { writes: Array<[string, string]>; execs: Array<[string, string[]]>; rms: string[] } {
  const writes: Array<[string, string]> = [];
  const execs: Array<[string, string[]]> = [];
  const rms: string[] = [];
  return {
    writes, execs, rms,
    async writeFile(path, content) { writes.push([path, content]); },
    async mkdirp() {},
    exec(cmd, args) { execs.push([cmd, args]); },
    async rm(path) { rms.push(path); },
    homedir: () => "/home/u",
  };
}

const spec: DaemonScheduleSpec = {
  label: "com.kunpeng.ops.demo", binPath: "/usr/bin/node",
  args: ["/x/cli.js", "ops", "--repo", "/r"], intervalSeconds: 3600, workingDir: "/x",
  env: { KUNPENG_BACKEND: "codex" },
};

describe("B5a:daemon-schedule 抽象层", () => {
  it("平台判定", () => {
    expect(daemonPlatform("darwin")).toBe("launchd");
    expect(daemonPlatform("linux")).toBe("systemd");
    expect(daemonPlatform("win32")).toBe("unsupported");
  });

  it("systemd 单元渲染", () => {
    expect(systemdUnitName("com.kunpeng.ops.demo")).toBe("kunpeng-com-kunpeng-ops-demo");
    const svc = renderSystemdService(spec);
    expect(svc).toContain("ExecStart=/usr/bin/node /x/cli.js ops --repo /r");
    expect(svc).toContain('Environment="KUNPENG_BACKEND=codex"');
    expect(svc).toContain("WorkingDirectory=/x");
    const timer = renderSystemdTimer(spec);
    expect(timer).toContain("OnUnitActiveSec=3600");
    expect(timer).toContain("WantedBy=timers.target");
  });

  it("launchd install/uninstall 走 plist+launchctl", async () => {
    const io = fakeIo();
    const r = await installDaemonSchedule(spec, "launchd", io);
    expect(r.paths[0]).toBe("/home/u/Library/LaunchAgents/com.kunpeng.ops.demo.plist");
    expect(io.writes[0][0]).toBe(r.paths[0]);
    expect(io.execs.some(([c, a]) => c === "launchctl" && a[0] === "load")).toBe(true);
    const u = await uninstallDaemonSchedule("com.kunpeng.ops.demo", "launchd", io);
    expect(u.removed[0]).toContain(".plist");
  });

  it("systemd install 写双单元并 enable timer;unsupported 报错", async () => {
    const io = fakeIo();
    const r = await installDaemonSchedule(spec, "systemd", io);
    expect(r.paths.some((p) => p.endsWith(".service"))).toBe(true);
    expect(r.paths.some((p) => p.endsWith(".timer"))).toBe(true);
    expect(r.paths[0]).toContain("/home/u/.config/systemd/user/");
    expect(io.execs.some(([c, a]) => c === "systemctl" && a.includes("daemon-reload"))).toBe(true);
    expect(io.execs.some(([c, a]) => c === "systemctl" && a.includes("enable"))).toBe(true);
    await expect(installDaemonSchedule(spec, "unsupported", fakeIo())).rejects.toThrow(/不支持/);
  });
});