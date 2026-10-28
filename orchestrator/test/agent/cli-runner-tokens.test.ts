import { expect, test } from "vitest";

import { CliRunner } from "../../src/agent/cli-runner.js";

test("CliRunner extracts tokens used banner into result metadata", async () => {
  const runner = new CliRunner({
    backend: "codex",
    exec: async () => ({ stdout: "done\ntokens used\n12,540\n", stderr: "" }),
  });

  const result = await runner.run({ stage: "implement", system: "", input: "", tools: [], cwd: "/tmp" });

  expect(result.meta.tokens).toBe(12540);
});

test("CliRunner parses codex --json JSONL text, tokens, and TESTCMD metadata", async () => {
  const runner = new CliRunner({
    backend: "codex",
    exec: async (_file, args) => {
      expect(args).toContain("--json");
      return {
        stdout: [
          JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "spec body\nTESTCMD: npm test\n" } }),
          JSON.stringify({ type: "turn.completed", usage: { output_tokens: 31 } }),
        ].join("\n"),
        stderr: "stderr TESTCMD: should-not-win",
      };
    },
  });

  const result = await runner.run({ stage: "spec", system: "", input: "x", tools: [], cwd: "/tmp" });

  expect(result.text).toBe("spec body\nTESTCMD: npm test\n");
  expect(result.meta.tokens).toBe(31);
  expect(result.meta.testCmd).toBe("npm test");
});

test("CliRunner omits tokens metadata when output has no banner", async () => {
  const runner = new CliRunner({
    backend: "codex",
    exec: async () => ({ stdout: "done without usage banner\n", stderr: "" }),
  });

  const result = await runner.run({ stage: "implement", system: "", input: "", tools: [], cwd: "/tmp" });

  expect(result.meta).not.toHaveProperty("tokens");
});
