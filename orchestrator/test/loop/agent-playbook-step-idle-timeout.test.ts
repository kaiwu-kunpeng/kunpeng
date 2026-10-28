import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { stepRunnerOptions } from "../../src/loop/recipes/agent-playbook/runwave.js";

describe("agent-playbook 步骤预算覆盖空闲超时", () => {
  it("给了 timeoutMs 的步，idleTimeoutMs 等于步骤预算", () => {
    expect(stepRunnerOptions(1_200_000)).toEqual({
      backend: "claude",
      timeoutMs: 1_200_000,
      idleTimeoutMs: 1_200_000,
    });
    expect(stepRunnerOptions(900_000)).toEqual({
      backend: "claude",
      timeoutMs: 900_000,
      idleTimeoutMs: 900_000,
    });
  });

  it("没给 timeoutMs 的步只带 backend，不带任何超时键（与现状一致）", () => {
    const opts = stepRunnerOptions(undefined);
    expect(opts).toEqual({ backend: "claude" });
    expect("timeoutMs" in opts).toBe(false);
    expect("idleTimeoutMs" in opts).toBe(false);
  });

  it("defaultRunner 真的通过 stepRunnerOptions 构造 CliRunner，旧的只传 timeoutMs 的写法已消失", () => {
    const src = readFileSync(
      join(process.cwd(), "src", "loop", "recipes", "agent-playbook", "runwave.ts"),
      "utf8",
    );
    expect(src).toMatch(/new CliRunner\(stepRunnerOptions\(timeoutMs\)\)/);
    expect(src).not.toContain("...(timeoutMs === undefined ? {} : { timeoutMs })");
  });
});