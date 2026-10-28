import { describe, expect, it } from "vitest";
import { CliRunner, type StreamExecFn } from "../../src/agent/cli-runner.js";
import type { StreamDelta } from "../../src/agent/cli-stream-parse.js";

const claudeLines = [
  JSON.stringify({ type: "system", subtype: "init" }),
  JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hello" } } }),
  JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: " world" } } }),
  JSON.stringify({ type: "result", subtype: "success", result: "Hello world", usage: { input_tokens: 100, output_tokens: 7 }, modelUsage: { "claude-opus-4-8": {} } }),
];

describe("CliRunner.runStreaming", () => {
  it("流式回调按序收到 text 增量,组装全文 + tokens", async () => {
    const fakeStream: StreamExecFn = async (_file, _args, _cwd, onLine) => {
      for (const l of claudeLines) onLine(l);
      return { stdout: claudeLines.join("\n"), stderr: "", exitCode: 0 };
    };
    const runner = new CliRunner({ backend: "claude", availableBackends: new Set(["claude"]), streamExec: fakeStream });
    const deltas: StreamDelta[] = [];
    const res = await runner.runStreaming(
      { stage: "implement", system: "", input: "hi", tools: [] },
      (d) => deltas.push(d),
    );
    const texts = deltas.filter((d) => d.text).map((d) => d.text);
    expect(texts).toEqual(["Hello", " world"]);
    expect(res.text).toBe("Hello world");
    expect(res.meta.tokens).toBe(107);
  });

  it("流式 spec 输出保留 TESTCMD metadata", async () => {
    const lines = [
      JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "spec\n" } } }),
      JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "TESTCMD: npm test\n" } } }),
      JSON.stringify({ type: "result", subtype: "success", result: "spec\nTESTCMD: npm test\n", usage: { input_tokens: 1, output_tokens: 2 } }),
    ];
    const fakeStream: StreamExecFn = async (_file, _args, _cwd, onLine) => {
      for (const l of lines) onLine(l);
      return { stdout: lines.join("\n"), stderr: "", exitCode: 0 };
    };
    const runner = new CliRunner({ backend: "claude", availableBackends: new Set(["claude"]), streamExec: fakeStream });
    const res = await runner.runStreaming(
      { stage: "spec", system: "", input: "hi", tools: [] },
      () => {},
    );

    expect(res.meta.testCmd).toBe("npm test");
    expect(res.meta.tokens).toBe(3);
  });
});
