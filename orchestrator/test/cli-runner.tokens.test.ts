import { expect, test } from "vitest";

import { parseBackendOutput } from "../src/agent/cli-runner.js";

test("claude json:取 result 正文 + usage 加和当 token", () => {
  const parsed = parseBackendOutput(
    "claude",
    JSON.stringify({ result: "hi", usage: { input_tokens: 100, output_tokens: 20 } }),
    "",
  );

  expect(parsed).toEqual({ text: "hi", tokens: 120 });
});

test("claude 非 json(未登录/纯文本)回退到文本+横幅", () => {
  const parsed = parseBackendOutput("claude", "tokens used 50", "");

  expect(parsed.text).toContain("tokens used 50");
  expect(parsed.tokens).toBe(50);
});

test("claude json 无 usage → tokens undefined,正文仍取 result", () => {
  const parsed = parseBackendOutput("claude", JSON.stringify({ result: "x" }), "");

  expect(parsed).toEqual({ text: "x", tokens: undefined });
});

test("codex:stdout+stderr 文本 + extractTokensUsed", () => {
  const parsed = parseBackendOutput("codex", "out tokens used 9", "err");

  expect(parsed.text).toBe("out tokens used 9err");
  expect(parsed.tokens).toBe(9);
});
