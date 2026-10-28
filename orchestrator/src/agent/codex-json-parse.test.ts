import { describe, expect, test } from "vitest";
import { parseCodexJsonl } from "./codex-json-parse.js";

// 真实 codex 0.139.0 --json 抓样
const REAL = [
  '{"type":"thread.started","thread_id":"019eefb5-7a2c-7ba1-a83e-d0e3048013d6"}',
  '{"type":"turn.started"}',
  '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"hello world"}}',
  '{"type":"turn.completed","usage":{"input_tokens":18613,"cached_input_tokens":4992,"output_tokens":26,"reasoning_output_tokens":18}}',
  "Shell cwd was reset to /Users/demo",
].join("\n");

describe("parseCodexJsonl", () => {
  test("real sample: extracts final message text and billed tokens (input−cached + output + 0.1×cached), ignores noise", () => {
    // (18613 − 4992) + 26 + round(4992 × 0.1) = 13621 + 26 + 499 = 14146
    expect(parseCodexJsonl(REAL)).toEqual({ text: "hello world", tokens: 14146 });
  });

  test("multiple agent_messages joined by newline; output_tokens summed", () => {
    const s = [
      '{"type":"item.completed","item":{"type":"agent_message","text":"part A"}}',
      '{"type":"turn.completed","usage":{"output_tokens":10}}',
      '{"type":"item.completed","item":{"type":"agent_message","text":"part B"}}',
      '{"type":"turn.completed","usage":{"output_tokens":5}}',
    ].join("\n");
    expect(parseCodexJsonl(s)).toEqual({ text: "part A\npart B", tokens: 15 });
  });

  test("no agent_message / no usage → empty text, zero tokens", () => {
    const s = '{"type":"thread.started","thread_id":"x"}\n{"type":"turn.started"}';
    expect(parseCodexJsonl(s)).toEqual({ text: "", tokens: 0 });
  });

  test("garbage and blank lines ignored, non-agent items skipped", () => {
    const s = [
      "",
      "not json at all",
      '{"type":"item.completed","item":{"type":"reasoning","text":"thinking"}}',
      '{"type":"item.completed","item":{"type":"agent_message","text":"ok"}}',
      "   ",
    ].join("\n");
    expect(parseCodexJsonl(s)).toEqual({ text: "ok", tokens: 0 });
  });
});