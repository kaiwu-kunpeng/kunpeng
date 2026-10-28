import { afterEach, beforeEach, expect, test } from "vitest";
import { CliRunner, type Backend } from "../src/agent/cli-runner.js";

let originalBackend: string | undefined;

beforeEach(() => {
  originalBackend = process.env.KUNPENG_BACKEND;
  delete process.env.KUNPENG_BACKEND;
});

afterEach(() => {
  if (originalBackend === undefined) {
    delete process.env.KUNPENG_BACKEND;
  } else {
    process.env.KUNPENG_BACKEND = originalBackend;
  }
});

test("CliRunner reacts to missing codex by retrying the same call on claude", async () => {
  const calls: string[] = [];
  const runner = new CliRunner({
    availableBackends: new Set<Backend>(["claude", "codex"]),
    exec: async (file) => {
      calls.push(file);
      if (file === "codex") {
        const e = new Error("spawn codex ENOENT") as Error & { code: string };
        e.code = "ENOENT";
        throw e;
      }
      return { stdout: "done", stderr: "" };
    },
  });

  const result = await runner.run({ stage: "implement", system: "", input: "x", tools: [], cwd: "/tmp" });

  expect(calls).toEqual(["codex", "claude"]);
  expect(result.backend).toBe("claude");
  expect(result.fellBack).toBe(true);
});

test("CliRunner returns preferred backend when codex is healthy", async () => {
  const calls: string[] = [];
  const runner = new CliRunner({
    availableBackends: new Set<Backend>(["claude", "codex"]),
    exec: async (file) => {
      calls.push(file);
      return { stdout: "done", stderr: "" };
    },
  });

  const result = await runner.run({ stage: "implement", system: "", input: "x", tools: [], cwd: "/tmp" });

  expect(calls).toEqual(["codex"]);
  expect(result.backend).toBe("codex");
  expect(result.fellBack).toBe(false);
});

test("CliRunner reports no usable backend after reactive failures exhaust both backends", async () => {
  const runner = new CliRunner({
    availableBackends: new Set<Backend>(["claude", "codex"]),
    exec: async (_file) => ({ stdout: "", stderr: "Not logged in · Please run /login" }),
  });

  await expect(runner.run({ stage: "implement", system: "", input: "x", tools: [], cwd: "/tmp" }))
    .rejects.toThrow("无可用后端（codex/claude 均不可用）");
});

test("CliRunner treats auth failure as unusable even when the CLI writes it to stdout", async () => {
  const calls: string[] = [];
  const runner = new CliRunner({
    availableBackends: new Set<Backend>(["claude", "codex"]),
    exec: async (file) => {
      calls.push(file);
      return { stdout: "Not logged in · Please run /login\n", stderr: "" };
    },
  });

  await expect(runner.run({ stage: "implement", system: "", input: "x", tools: [], cwd: "/tmp" }))
    .rejects.toThrow("无可用后端（codex/claude 均不可用）");
  expect(calls).toEqual(["codex", "claude"]);
});

test("exec 成功(有真实 stdout)即便 stderr 含 auth 字样也不丢结果、不误判下线", async () => {
  const calls: string[] = [];
  const runner = new CliRunner({
    availableBackends: new Set<Backend>(["claude", "codex"]),
    exec: async (file) => {
      calls.push(file);
      // 任务正文里碰巧出现 "authentication failed" —— 但 exec 成功且有真实产出
      return { stdout: "patched auth.ts: fixed authentication failed message", stderr: "" };
    },
  });

  const result = await runner.run({ stage: "implement", system: "", input: "x", tools: [], cwd: "/tmp" });

  expect(calls).toEqual(["codex"]);            // 没回退、没重试
  expect(result.backend).toBe("codex");
  expect(result.fellBack).toBe(false);
  expect(result.text).toContain("patched auth.ts");
});

test("stderr 含 auth 字样但有 stdout 产出 → 信任产出（不下线）", async () => {
  const calls: string[] = [];
  const runner = new CliRunner({
    availableBackends: new Set<Backend>(["claude", "codex"]),
    exec: async (file) => {
      calls.push(file);
      return { stdout: "real work output here", stderr: "warning: authentication failed for telemetry endpoint" };
    },
  });

  const result = await runner.run({ stage: "implement", system: "", input: "x", tools: [], cwd: "/tmp" });

  expect(calls).toEqual(["codex"]);            // 不因 stderr 噪声丢弃成功结果
  expect(result.backend).toBe("codex");
  expect(result.text).toContain("real work output here");
});

test("claude + tools 含 websearch → 注入 --allowedTools WebSearch WebFetch（否则 headless 无权联网）", async () => {
  let capturedArgs: string[] = [];
  const runner = new CliRunner({
    backend: "claude",
    availableBackends: new Set<Backend>(["claude"]),
    exec: async (_file, args) => { capturedArgs = args; return { stdout: "ok", stderr: "" }; },
  });

  await runner.run({ stage: "spec", system: "", input: "调研", tools: ["websearch"], cwd: "/tmp" });
  const i = capturedArgs.indexOf("--allowedTools");
  expect(i).toBeGreaterThanOrEqual(0);
  expect(capturedArgs.slice(i + 1, i + 3)).toEqual(["WebSearch", "WebFetch"]);
});

test("claude + 无 websearch 工具 → 不注入 --allowedTools", async () => {
  let capturedArgs: string[] = [];
  const runner = new CliRunner({
    backend: "claude",
    availableBackends: new Set<Backend>(["claude"]),
    exec: async (_file, args) => { capturedArgs = args; return { stdout: "ok", stderr: "" }; },
  });

  await runner.run({ stage: "implement", system: "", input: "x", tools: ["write", "edit"], cwd: "/tmp" });
  expect(capturedArgs).not.toContain("--allowedTools");
});
