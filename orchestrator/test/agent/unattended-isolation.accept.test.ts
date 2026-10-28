// 作者锁定（2026-09-28 审计 R05a）：非 macOS 上无人值守的 implement 阶段，没有写入围栏时 fail-closed。
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CliRunner, type Backend } from "../../src/agent/cli-runner.js";
import { unattendedIsolationRefusal, type UnattendedIsolationInput } from "../../src/agent/unattended-isolation.js";

const base: UnattendedIsolationInput = {
  platform: "linux",
  stage: "implement",
  backend: "claude",
  hasExecBackend: false,
  allowUnsandboxed: undefined,
};

let savedAllow: string | undefined;
let savedForced: string | undefined;
beforeEach(() => {
  savedAllow = process.env.KUNPENG_ALLOW_UNSANDBOXED;
  savedForced = process.env.KUNPENG_BACKEND;
  delete process.env.KUNPENG_ALLOW_UNSANDBOXED;
  delete process.env.KUNPENG_BACKEND;
});
afterEach(() => {
  if (savedAllow === undefined) delete process.env.KUNPENG_ALLOW_UNSANDBOXED; else process.env.KUNPENG_ALLOW_UNSANDBOXED = savedAllow;
  if (savedForced === undefined) delete process.env.KUNPENG_BACKEND; else process.env.KUNPENG_BACKEND = savedForced;
});

describe("unattendedIsolationRefusal 纯函数", () => {
  it("linux + claude + implement + 无容器 + 未放行 → 拒绝，文案点名放行变量与 execBackend", () => {
    const r = unattendedIsolationRefusal(base);
    expect(typeof r).toBe("string");
    expect(r).toContain("KUNPENG_ALLOW_UNSANDBOXED=1");
    expect(r).toContain("execBackend");
  });

  it("任一放行条件成立即返回 undefined", () => {
    expect(unattendedIsolationRefusal({ ...base, platform: "darwin" })).toBeUndefined();
    expect(unattendedIsolationRefusal({ ...base, backend: "codex" })).toBeUndefined();
    expect(unattendedIsolationRefusal({ ...base, hasExecBackend: true })).toBeUndefined();
    expect(unattendedIsolationRefusal({ ...base, allowUnsandboxed: "1" })).toBeUndefined();
    for (const stage of ["spec", "design", "review", "verify", "audit"]) {
      expect(unattendedIsolationRefusal({ ...base, stage })).toBeUndefined();
    }
  });

  it("放行变量只认字面量 1", () => {
    for (const v of ["", "0", "true", "yes"]) {
      expect(unattendedIsolationRefusal({ ...base, allowUnsandboxed: v })).toBeDefined();
    }
  });

  it("win32 等其它非 darwin 平台同样拒绝", () => {
    expect(unattendedIsolationRefusal({ ...base, platform: "win32" })).toBeDefined();
    expect(unattendedIsolationRefusal({ ...base, platform: "freebsd" })).toBeDefined();
  });
});

function runner(platform: string, backend: Backend, calls: string[], extra: Record<string, unknown> = {}): CliRunner {
  return new CliRunner({
    backend,
    platform,
    availableBackends: new Set<Backend>(["claude", "codex"]),
    exec: async (file) => { calls.push(file); return { stdout: "ok", stderr: "" }; },
    streamExec: async (file, _args, _cwd, onLine) => { calls.push(file); onLine(""); return { stdout: "ok", stderr: "", exitCode: 0 }; },
    ...extra,
  });
}

const implementReq = { stage: "implement" as const, system: "", input: "x", tools: ["write", "edit", "bash"], cwd: "/tmp" };

describe("CliRunner 接线：拒绝发生在 spawn 之前", () => {
  it("run()：linux + claude + implement → reject，且后端进程一次都没起", async () => {
    const calls: string[] = [];
    await expect(runner("linux", "claude", calls).run(implementReq)).rejects.toThrow(/KUNPENG_ALLOW_UNSANDBOXED/);
    expect(calls).toEqual([]);
  });

  it("runStreaming()：linux + claude + implement → reject，且后端进程一次都没起", async () => {
    const calls: string[] = [];
    await expect(runner("linux", "claude", calls).runStreaming(implementReq, () => {})).rejects.toThrow(/KUNPENG_ALLOW_UNSANDBOXED/);
    expect(calls).toEqual([]);
  });

  it("run()：放行条件下照常调用后端", async () => {
    const a: string[] = [];
    await runner("darwin", "claude", a).run(implementReq);
    expect(a).toEqual(["claude"]);

    const b: string[] = [];
    await runner("linux", "codex", b).run(implementReq);
    expect(b).toEqual(["codex"]);

    const c: string[] = [];
    await runner("linux", "claude", c).run({ ...implementReq, stage: "verify" });
    expect(c).toEqual(["claude"]);

    const d: string[] = [];
    await runner("linux", "claude", d, { execBackend: { kind: "docker", image: "kp-agent:latest" } }).run(implementReq);
    expect(d).toEqual(["claude"]);

    process.env.KUNPENG_ALLOW_UNSANDBOXED = "1";
    const e: string[] = [];
    await runner("linux", "claude", e).run(implementReq);
    expect(e).toEqual(["claude"]);
  });

  it("不传 platform 时取 process.platform（本机 darwin 上 implement 照常执行）", async () => {
    const calls: string[] = [];
    const r = new CliRunner({
      backend: "claude",
      availableBackends: new Set<Backend>(["claude"]),
      exec: async (file) => { calls.push(file); return { stdout: "ok", stderr: "" }; },
    });
    if (process.platform === "darwin") {
      await r.run(implementReq);
      expect(calls).toEqual(["claude"]);
    } else {
      await expect(r.run(implementReq)).rejects.toThrow(/KUNPENG_ALLOW_UNSANDBOXED/);
    }
  });
});