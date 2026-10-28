import { afterEach, beforeEach, expect, test } from "vitest";
import { CliRunner, type Backend, type StreamExecFn } from "../../src/agent/cli-runner.js";
import { SAME_BACKEND_NOTICE } from "../../src/agent/backend-routing.js";

let savedVerify: string | undefined;
let savedForced: string | undefined;
beforeEach(() => {
  savedVerify = process.env.KUNPENG_VERIFY_BACKEND;
  savedForced = process.env.KUNPENG_BACKEND;
  delete process.env.KUNPENG_VERIFY_BACKEND;
  delete process.env.KUNPENG_BACKEND;
});
afterEach(() => {
  if (savedVerify === undefined) delete process.env.KUNPENG_VERIFY_BACKEND; else process.env.KUNPENG_VERIFY_BACKEND = savedVerify;
  if (savedForced === undefined) delete process.env.KUNPENG_BACKEND; else process.env.KUNPENG_BACKEND = savedForced;
});

function runnerWith(available: Backend[], calls: string[], events: string[], extra: { backend?: Backend } = {}) {
  return new CliRunner({
    ...extra,
    availableBackends: new Set<Backend>(available),
    onEvent: (m) => events.push(m),
    exec: async (file) => {
      calls.push(file);
      return { stdout: "verdict", stderr: "" };
    },
  });
}

test("run(): avoidBackend=codex 的 verify 调用走 claude；avoidBackend=claude 走 codex（默认 verify=claude 被改写）", async () => {
  const calls: string[] = [];
  const events: string[] = [];
  const runner = runnerWith(["claude", "codex"], calls, events);
  const a = await runner.run({ stage: "verify", system: "", input: "x", tools: [], cwd: "/tmp", avoidBackend: "codex" });
  const b = await runner.run({ stage: "verify", system: "", input: "x", tools: [], cwd: "/tmp", avoidBackend: "claude" });
  expect(calls).toEqual(["claude", "codex"]);
  expect(a.backend).toBe("claude");
  expect(b.backend).toBe("codex");
  expect(a.fellBack).toBe(false);
  expect(b.fellBack).toBe(false);
  expect(events).toEqual([]);
});

test("run(): 只有一个后端可用 → 同后端评估，并通过 onEvent 记一行日志（只记一次）", async () => {
  const calls: string[] = [];
  const events: string[] = [];
  const runner = runnerWith(["claude"], calls, events);
  const r = await runner.run({ stage: "verify", system: "", input: "x", tools: [], cwd: "/tmp", avoidBackend: "claude" });
  expect(calls).toEqual(["claude"]);
  expect(r.backend).toBe("claude");
  expect(events).toEqual([SAME_BACKEND_NOTICE]);
  expect(SAME_BACKEND_NOTICE).toBe("[verify] 仅一个后端可用，评估器与实现者同后端");
});

test("run(): 强制单后端（opts.backend）时评估器同后端且记日志；KUNPENG_VERIFY_BACKEND 显式覆盖压过强制", async () => {
  const calls: string[] = [];
  const events: string[] = [];
  const forced = runnerWith(["claude", "codex"], calls, events, { backend: "claude" });
  const r1 = await forced.run({ stage: "verify", system: "", input: "x", tools: [], cwd: "/tmp", avoidBackend: "claude" });
  expect(r1.backend).toBe("claude");
  expect(events).toEqual([SAME_BACKEND_NOTICE]);

  process.env.KUNPENG_VERIFY_BACKEND = "codex";
  const r2 = await forced.run({ stage: "verify", system: "", input: "x", tools: [], cwd: "/tmp", avoidBackend: "claude" });
  expect(r2.backend).toBe("codex");
  expect(calls).toEqual(["claude", "codex"]);
  expect(events).toHaveLength(1);
});

test("run(): 不带 avoidBackend 时路由不变（verify→claude，implement→codex）", async () => {
  const calls: string[] = [];
  const events: string[] = [];
  const runner = runnerWith(["claude", "codex"], calls, events);
  await runner.run({ stage: "verify", system: "", input: "x", tools: [], cwd: "/tmp" });
  await runner.run({ stage: "implement", system: "", input: "x", tools: [], cwd: "/tmp" });
  expect(calls).toEqual(["claude", "codex"]);
  expect(events).toEqual([]);
});

test("runStreaming(): avoidBackend 同样生效", async () => {
  const files: string[] = [];
  const lines = [
    JSON.stringify({ type: "result", subtype: "success", result: "pass", usage: { input_tokens: 1, output_tokens: 1 } }),
  ];
  const fakeStream: StreamExecFn = async (file, _args, _cwd, onLine) => {
    files.push(file);
    for (const l of lines) onLine(l);
    return { stdout: lines.join("\n"), stderr: "", exitCode: 0 };
  };
  const events: string[] = [];
  const runner = new CliRunner({ availableBackends: new Set<Backend>(["claude", "codex"]), streamExec: fakeStream, onEvent: (m) => events.push(m) });
  const res = await runner.runStreaming({ stage: "verify", system: "", input: "x", tools: [], avoidBackend: "claude" }, () => {});
  expect(files).toEqual(["codex"]);
  expect(res.backend).toBe("codex");
  expect(events).toEqual([]);
});