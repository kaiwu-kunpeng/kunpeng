import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backendHealthPath, loadBackendHealth, markBackendDown } from "../../src/agent/backend-health.js";
import { CliRunner, type Backend } from "../../src/agent/cli-runner.js";

let dir: string;
let healthPath: string;
let originalBackend: string | undefined;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kp-degrade-"));
  healthPath = backendHealthPath(join(dir, ".kunpeng"));
  originalBackend = process.env.KUNPENG_BACKEND;
  delete process.env.KUNPENG_BACKEND;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  if (originalBackend === undefined) delete process.env.KUNPENG_BACKEND;
  else process.env.KUNPENG_BACKEND = originalBackend;
});

const both = () => new Set<Backend>(["claude", "codex"]);
const req = { stage: "implement" as const, system: "", input: "x", tools: [], cwd: "/tmp" };
const fail = (stderr: string, exitCode = 1) => Object.assign(new Error(stderr), { stderr, exitCode });

describe("后端降级链（作者锁定）", () => {
  it("403 → 标 codex 下线（持久化 kind=auth）并回退 claude；chain 记录两步", async () => {
    const calls: string[] = [];
    const runner = new CliRunner({
      availableBackends: both(), healthPath,
      exec: async (file) => { calls.push(file); if (file === "codex") throw fail("HTTP 403 Forbidden"); return { stdout: "done", stderr: "", exitCode: 0 }; },
    });
    const r = await runner.run(req);
    expect(calls).toEqual(["codex", "claude"]);
    expect(r.backend).toBe("claude");
    expect(r.fellBack).toBe(true);
    expect(r.chain).toEqual(["codex:gpt-6-astra", "claude:claude-opus-5"]);
    const health = loadBackendHealth(healthPath, Date.now());
    expect(health.backends.codex?.kind).toBe("auth");
    expect(health.backends.claude).toBeUndefined();
  });

  it("非零退出码 + usage limit reached → 标 quota 下线并回退，不再把失败当成功返回", async () => {
    const calls: string[] = [];
    const runner = new CliRunner({
      availableBackends: both(), healthPath,
      exec: async (file) => { calls.push(file); if (file === "codex") return { stdout: "", stderr: "usage limit reached", exitCode: 1 }; return { stdout: "ok", stderr: "", exitCode: 0 }; },
    });
    const r = await runner.run(req);
    expect(calls).toEqual(["codex", "claude"]);
    expect(r.text).toBe("ok");
    expect(loadBackendHealth(healthPath, Date.now()).backends.codex?.kind).toBe("quota");
  });

  it("model not found → 同后端降一档：第二次调用 codex 带 -m gpt-5.6-terra；模型下线持久化", async () => {
    const seen: string[][] = [];
    const runner = new CliRunner({
      availableBackends: both(), healthPath,
      exec: async (file, args) => {
        seen.push([file, ...args]);
        if (file === "codex" && args.includes("gpt-6-astra")) throw fail("error: model gpt-6-astra not found");
        return { stdout: "done", stderr: "", exitCode: 0 };
      },
    });
    const r = await runner.run(req);
    expect(seen.map((s) => s[0])).toEqual(["codex", "codex"]);
    expect(seen[1]).toContain("gpt-5.6-terra");
    expect(r.backend).toBe("codex");
    expect(r.chain).toEqual(["codex:gpt-6-astra", "codex:gpt-5.6-terra"]);
    const health = loadBackendHealth(healthPath, Date.now());
    expect(health.models["codex:gpt-6-astra"]?.kind).toBe("model-unavailable");
    expect(health.backends.codex).toBeUndefined();
  });

  it("持久化的下线标记跨实例生效；过期后失效", async () => {
    markBackendDown(healthPath, "codex", { kind: "quota", reason: "x", ttlMs: 60_000, now: Date.now() });
    const calls: string[] = [];
    const r = await new CliRunner({ availableBackends: both(), healthPath, exec: async (file) => { calls.push(file); return { stdout: "ok", stderr: "", exitCode: 0 }; } }).run(req);
    expect(calls).toEqual(["claude"]);
    expect(r.fellBack).toBe(true);
    markBackendDown(healthPath, "codex", { kind: "quota", reason: "x", ttlMs: 1, now: Date.now() - 10_000 });
    const calls2: string[] = [];
    await new CliRunner({ availableBackends: both(), healthPath, exec: async (file) => { calls2.push(file); return { stdout: "ok", stderr: "", exitCode: 0 }; } }).run(req);
    expect(calls2).toEqual(["codex"]);
  });

  it("退出码 0 + 空正文 + 零 token：开关开 → 短 TTL 下线并回退；开关缺省（注入 exec）→ 旧行为", async () => {
    const calls: string[] = [];
    const r = await new CliRunner({
      availableBackends: both(), healthPath, emptyResponseIsFailure: true,
      exec: async (file) => { calls.push(file); return file === "codex" ? { stdout: "", stderr: "", exitCode: 0 } : { stdout: "ok", stderr: "", exitCode: 0 }; },
    }).run(req);
    expect(calls).toEqual(["codex", "claude"]);
    expect(r.text).toBe("ok");
    const entry = loadBackendHealth(healthPath, Date.now()).backends.codex;
    expect(entry?.kind).toBe("empty-response");
    expect(entry!.downUntil - entry!.at).toBe(5 * 60_000);
    const calls2: string[] = [];
    const r2 = await new CliRunner({ availableBackends: both(), exec: async (file) => { calls2.push(file); return { stdout: "", stderr: "", exitCode: 0 }; } }).run(req);
    expect(calls2).toEqual(["codex"]);
    expect(r2.text).toBe("");
  });

  it("runStreaming：401 抛错 → 回退 claude；空流 + 开关开 → 回退", async () => {
    const calls: string[] = [];
    const runner = new CliRunner({
      availableBackends: both(), healthPath,
      streamExec: async (file, _args, _cwd, onLine) => {
        calls.push(file);
        if (file === "codex") throw fail("HTTP 401 Unauthorized");
        onLine(JSON.stringify({ type: "result", result: "streamed", usage: { input_tokens: 1, output_tokens: 2 } }));
        return { stdout: "", stderr: "", exitCode: 0 };
      },
    });
    const r = await runner.runStreaming(req, () => {});
    expect(calls).toEqual(["codex", "claude"]);
    expect(r.text).toBe("streamed");
    expect(r.fellBack).toBe(true);
    expect(loadBackendHealth(healthPath, Date.now()).backends.codex?.kind).toBe("auth");

    const calls2: string[] = [];
    const r2 = await new CliRunner({
      availableBackends: both(), emptyResponseIsFailure: true,
      streamExec: async (file, _args, _cwd, onLine) => {
        calls2.push(file);
        if (file === "claude") onLine(JSON.stringify({ type: "result", result: "late", usage: { input_tokens: 1, output_tokens: 1 } }));
        return { stdout: "", stderr: "", exitCode: 0 };
      },
    }).runStreaming(req, () => {});
    expect(calls2).toEqual(["codex", "claude"]);
    expect(r2.text).toBe("late");
  });
});