import { describe, expect, it } from "vitest";
import { CliRunner, DEFAULT_IDLE_TIMEOUT_MS, type StreamExecFn } from "../../src/agent/cli-runner.js";

describe("cli-runner-idle-default", () => {
  it("runStreaming uses the default stream idle timeout when not configured", async () => {
    let seenIdleTimeoutMs: number | undefined;
    const fakeStream: StreamExecFn = async (_file, _args, _cwd, onLine, _env, _stdinInput, idleTimeoutMs) => {
      seenIdleTimeoutMs = idleTimeoutMs;
      onLine(JSON.stringify({ type: "result", subtype: "success", result: "ok" }));
      return { stdout: "", stderr: "", exitCode: 0 };
    };
    const runner = new CliRunner({
      backend: "claude",
      availableBackends: new Set(["claude"]),
      streamExec: fakeStream,
    });

    await runner.runStreaming(
      { stage: "implement", system: "", input: "hi", tools: [] },
      () => {},
    );

    expect(seenIdleTimeoutMs).toBe(DEFAULT_IDLE_TIMEOUT_MS);
  });

  it("runStreaming lets explicit idleTimeoutMs override the default", async () => {
    let seenIdleTimeoutMs: number | undefined;
    const fakeStream: StreamExecFn = async (_file, _args, _cwd, onLine, _env, _stdinInput, idleTimeoutMs) => {
      seenIdleTimeoutMs = idleTimeoutMs;
      onLine(JSON.stringify({ type: "result", subtype: "success", result: "ok" }));
      return { stdout: "", stderr: "", exitCode: 0 };
    };
    const runner = new CliRunner({
      backend: "claude",
      availableBackends: new Set(["claude"]),
      idleTimeoutMs: 1_234,
      streamExec: fakeStream,
    });

    await runner.runStreaming(
      { stage: "implement", system: "", input: "hi", tools: [] },
      () => {},
    );

    expect(seenIdleTimeoutMs).toBe(1_234);
  });
});
