import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CliRunner } from "../../src/agent/cli-runner.js";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("阶段方法论接线（作者锁定）", () => {
  it("buildPrompt 按 runner 宿主注入：codex 看到沙箱段、claude 看到禁改段；spec 仍带 TESTCMD，implement 仍不带", () => {
    const codex = new CliRunner({ backend: "codex" });
    const claude = new CliRunner({ backend: "claude" });
    const codexImpl = codex.buildPrompt({ stage: "implement", system: "", input: "do x", tools: [] });
    const claudeImpl = claude.buildPrompt({ stage: "implement", system: "", input: "do x", tools: [] });
    expect(codexImpl).toContain("workspace-write 沙箱");
    expect(codexImpl).not.toContain("不要修改 .kunpeng/");
    expect(claudeImpl).toContain("不要修改 .kunpeng/");
    expect(claudeImpl).not.toContain("workspace-write 沙箱");
    expect(codexImpl).not.toContain("TESTCMD");
    expect(codexImpl).toContain("# Stage: implement");
    expect(codex.buildPrompt({ stage: "spec", system: "", input: "do x", tools: [] })).toContain("TESTCMD");
  });

  it("源码接线：cli-runner 两个阶段与 dev-cycle 的 verify 评估器都读方法论文件", () => {
    const runner = read("../../src/agent/cli-runner.ts");
    expect(runner).toContain('loadStageMethodology("plan"');
    expect(runner).toContain('loadStageMethodology("implement"');
    const devCycle = read("../../src/loop/dev-cycle.ts");
    expect(devCycle).toContain('loadStageMethodology("verify"');
  });
});