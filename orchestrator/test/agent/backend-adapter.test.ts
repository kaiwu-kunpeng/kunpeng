import { describe, expect, test } from "vitest";
import {
  claudeAdapter, codexAdapter, getAdapter, listAdapters, registerAdapter,
  type BackendAdapter,
} from "../../src/agent/backend-adapter.js";

describe("backend adapter registry", () => {
  test("内置注册 claude+codex", () => {
    const names = listAdapters();
    expect(names).toContain("claude");
    expect(names).toContain("codex");
    expect(getAdapter("claude")).toBeDefined();
    expect(getAdapter("codex")).toBeDefined();
    expect(getAdapter("nope")).toBeUndefined();
  });

  test("claude.invoke: stdin + --output-format json + 带 model + web", () => {
    const inv = claudeAdapter.invoke({ model: "sonnet" }, []);
    expect(inv.bin).toBe("claude");
    expect(inv.promptVia).toBe("stdin");
    const i = inv.args.indexOf("--output-format");
    expect(i).toBeGreaterThanOrEqual(0);
    expect(inv.args[i + 1]).toBe("json");
    const m = inv.args.indexOf("--model");
    expect(inv.args[m + 1]).toBe("sonnet");
    expect(inv.args.join(" ")).not.toContain("prompt-body");
    const webInv = claudeAdapter.invoke({}, ["websearch"]);
    expect(webInv.args).toContain("--allowedTools");
  });

  test("codex.invoke: exec + effort", () => {
    const inv = codexAdapter.invoke({ effort: "low" }, []);
    expect(inv.bin).toBe("codex");
    expect(inv.args[0]).toBe("exec");
    expect(inv.args).toContain("--json");
    expect(inv.args.join(" ")).toContain("model_reasoning_effort=low");
    expect(inv.promptVia).toBe("stdin");
  });

  test("claude.parseOutput: json 取 result+usage,非 json 回退横幅", () => {
    const r = claudeAdapter.parseOutput(JSON.stringify({ result: "hi", usage: { input_tokens: 100, output_tokens: 20 } }), "");
    expect(r).toEqual({ text: "hi", tokens: 120 });
    const fallback = claudeAdapter.parseOutput("tokens used 9", "");
    expect(fallback.tokens).toBe(9);
  });

  test("codex.parseOutput: tokens used 横幅", () => {
    const r = codexAdapter.parseOutput("out tokens used 50", "err");
    expect(r.text).toBe("out tokens used 50err");
    expect(r.tokens).toBe(50);
  });

  test("codex.parseOutput: --json JSONL 只取 agent_message;token 按计费口径 input+output", () => {
    const stdout = [
      JSON.stringify({ type: "thread.started", thread_id: "t1" }),
      JSON.stringify({ type: "item.completed", item: { type: "reasoning", text: "hidden" } }),
      JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "spec\nTESTCMD: npm test\n" } }),
      JSON.stringify({ type: "turn.completed", usage: { input_tokens: 10, output_tokens: 7 } }),
      "not json",
    ].join("\n");

    const r = codexAdapter.parseOutput(stdout, "stderr noise");
    expect(r).toEqual({ text: "spec\nTESTCMD: npm test\n", tokens: 17 });
  });

  test("registerAdapter 可加新后端", () => {
    const qwen: BackendAdapter = {
      name: "qwen", kind: "http", authEnv: [],
      invoke: () => ({ bin: "x", args: [], promptVia: "argv" }),
      parseOutput: () => ({ text: "", tokens: 1 }),
    };
    registerAdapter(qwen);
    expect(getAdapter("qwen")).toBe(qwen);
    expect(listAdapters()).toContain("qwen");
  });
});