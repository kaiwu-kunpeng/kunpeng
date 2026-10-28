import { describe, expect, it } from "vitest";
import { CliRunner, spawnCapture, type StreamExecFn } from "../../src/agent/cli-runner.js";

describe("CliRunner idle timeout", () => {
  it("runStreaming 把 idleTimeoutMs 传给 streamExec", async () => {
    let seenIdleTimeoutMs: number | undefined;
    const fakeStream: StreamExecFn = async (_file, _args, _cwd, onLine, _env, _stdinInput, idleTimeoutMs) => {
      seenIdleTimeoutMs = idleTimeoutMs;
      onLine(JSON.stringify({ type: "result", subtype: "success", result: "ok", usage: { input_tokens: 1, output_tokens: 1 } }));
      return { stdout: "", stderr: "", exitCode: 0 };
    };
    const runner = new CliRunner({
      backend: "claude",
      availableBackends: new Set(["claude"]),
      idleTimeoutMs: 1234,
      streamExec: fakeStream,
    });

    await runner.runStreaming(
      { stage: "implement", system: "", input: "hi", tools: [] },
      () => {},
    );

    expect(seenIdleTimeoutMs).toBe(1234);
  });

  it("spawnCapture kills silent children after idle timeout", async () => {
    await expect(spawnCapture(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      process.cwd(),
      2_000,
      undefined,
      undefined,
      50,
    )).rejects.toThrow(/空闲超时 50ms/);
  });

  it("spawnCapture refreshes idle timeout when output arrives", async () => {
    const out = await spawnCapture(
      process.execPath,
      ["-e", "let n = 0; const t = setInterval(() => { process.stdout.write(String(++n)); if (n === 4) { clearInterval(t); } }, 25);"],
      process.cwd(),
      2_000,
      undefined,
      undefined,
      50,
    );

    expect(out.stdout).toBe("1234");
  });
});
