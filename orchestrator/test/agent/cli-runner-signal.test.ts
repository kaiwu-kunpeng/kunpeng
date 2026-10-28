import { describe, expect, it } from "vitest";
import { CliRunner, type StreamExecFn } from "../../src/agent/cli-runner.js";

describe("cli-runner-signal — AbortSignal 透传到子进程", () => {
  it("runStreaming 把 req.signal 作为末位实参传给 streamExec", async () => {
    let seenSignal: AbortSignal | undefined;
    const fakeStream: StreamExecFn = async (_file, _args, _cwd, onLine, _env, _stdin, _idle, signal) => {
      seenSignal = signal;
      onLine(JSON.stringify({ type: "result", subtype: "success", result: "ok" }));
      return { stdout: "", stderr: "", exitCode: 0 };
    };
    const runner = new CliRunner({
      backend: "claude",
      availableBackends: new Set(["claude"]),
      streamExec: fakeStream,
    });
    const ac = new AbortController();
    await runner.runStreaming(
      { stage: "implement", system: "", input: "hi", tools: [], signal: ac.signal },
      () => {},
    );
    expect(seenSignal).toBe(ac.signal);
  });

  it("无 signal 时 streamExec 收到 undefined(向后兼容)", async () => {
    let seenSignal: AbortSignal | undefined = {} as AbortSignal;
    const fakeStream: StreamExecFn = async (_file, _args, _cwd, onLine, _env, _stdin, _idle, signal) => {
      seenSignal = signal;
      onLine(JSON.stringify({ type: "result", subtype: "success", result: "ok" }));
      return { stdout: "", stderr: "", exitCode: 0 };
    };
    const runner = new CliRunner({
      backend: "claude",
      availableBackends: new Set(["claude"]),
      streamExec: fakeStream,
    });
    await runner.runStreaming({ stage: "implement", system: "", input: "hi", tools: [] }, () => {});
    expect(seenSignal).toBeUndefined();
  });
});