import { expect, test } from "vitest";
import { CliRunner, spawnCapture } from "../src/agent/cli-runner.js";

test("spawnCapture kills the child and rejects on timeout (no infinite hang)", async () => {
  await expect(spawnCapture("sleep", ["5"], process.cwd(), 200)).rejects.toThrow(/超时|timed out/);
});

test("spec prompt asks for a TESTCMD derived from acceptance criteria", () => {
  const r = new CliRunner({ backend: "codex" });
  const p = r.buildPrompt({ stage: "spec", system: "rules", input: "do x", tools: [] });
  expect(p).toContain("TESTCMD");
  expect(p).toContain("do x");
});

test("implement prompt does NOT let the implementer define TESTCMD (C3)", () => {
  const r = new CliRunner({ backend: "codex" });
  const p = r.buildPrompt({ stage: "implement", system: "", input: "do x", tools: [] });
  expect(p).not.toContain("TESTCMD");
  expect(p).toContain("do x");
});

test("parses TESTCMD from injected CLI output", async () => {
  const r = new CliRunner({
    backend: "claude",
    exec: async () => ({ stdout: "edited files\nTESTCMD: node -e \"process.exit(0)\"", stderr: "" }),
  });
  const res = await r.run({ stage: "implement", system: "", input: "", tools: [], cwd: "/tmp" });
  expect(res.meta.testCmd).toBe('node -e "process.exit(0)"');
});

test("default backend is configurable, never requires an API key", () => {
  const r = new CliRunner();
  expect(["claude", "codex"]).toContain(r.backend);
});

test("codex routes the light spec stage to low effort (Token T3)", async () => {
  let captured: string[] = [];
  const r = new CliRunner({
    backend: "codex",
    exec: async (_f, args) => { captured = args; return { stdout: "", stderr: "" }; },
  });
  await r.run({ stage: "spec", system: "", input: "x", tools: [], cwd: "/tmp" });
  expect(captured).toContain("-c");
  expect(captured.some((a) => a.includes("model_reasoning_effort=low"))).toBe(true);
});

test("explicit request model overrides the route (codex -m)", async () => {
  let captured: string[] = [];
  const r = new CliRunner({
    backend: "codex",
    exec: async (_f, args) => { captured = args; return { stdout: "", stderr: "" }; },
  });
  await r.run({ stage: "implement", system: "", input: "x", tools: [], cwd: "/tmp", model: "gpt-5.5" });
  expect(captured).toContain("-m");
  expect(captured).toContain("gpt-5.5");
});
