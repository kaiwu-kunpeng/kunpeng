import { describe, it, expect } from "vitest";
import { sandboxDecision, type SandboxDecisionInput } from "../../src/agent/sandbox-signal.js";

// 防「实现者悄悄加分支」：把所有可能的输入组合跑一遍，收集到的 reason 去重后
// 必须恰好等于下面这个集合。多一个分支（哪怕行为合理）也判红，逼它先进 spec。
const EXPECTED_REASONS = [
  "codex-incompatible",
  "disabled-by-default",
  "engaged",
  "no-cwd",
  "no-scope",
  "sandbox-exec-unavailable",
];

function allInputs(): SandboxDecisionInput[] {
  const out: SandboxDecisionInput[] = [];
  for (const envValue of [undefined, "0", "1", "true", ""]) {
    for (const cwd of [undefined, "", "/wt"]) {
      for (const scopeAllowCount of [0, 1, 3]) {
        for (const available of [true, false]) {
          for (const backend of [undefined, "claude", "codex", "other"]) {
            out.push({ envValue, cwd, scopeAllowCount, available, backend });
          }
        }
      }
    }
  }
  return out;
}

describe("reason 完整集合锁定", () => {
  it("穷举全部输入后，reason 去重恰好等于约定集合", () => {
    const seen = new Set(allInputs().map((i) => sandboxDecision(i).reason));
    expect([...seen].sort()).toEqual(EXPECTED_REASONS);
  });

  it("engaged 为真当且仅当 reason 是 engaged", () => {
    for (const input of allInputs()) {
      const d = sandboxDecision(input);
      expect(d.engaged).toBe(d.reason === "engaged");
    }
  });

  it("穷举中不出现已废弃的 disabled-by-env", () => {
    const seen = new Set(allInputs().map((i) => sandboxDecision(i).reason));
    expect(seen.has("disabled-by-env")).toBe(false);
  });
});