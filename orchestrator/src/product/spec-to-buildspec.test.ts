import { describe, expect, test } from "vitest";
import { specToBuildSpec, buildSpecPrompt } from "./spec-to-buildspec.js";
import type { AgentRunner, AgentRequest, AgentResult } from "../agent/runner.js";

class StubRunner implements AgentRunner {
  public lastReq?: AgentRequest;
  constructor(private result: AgentResult) {}
  async run(req: AgentRequest): Promise<AgentResult> { this.lastReq = req; return this.result; }
}

describe("specToBuildSpec", () => {
  test("从 agent 的 {buildSpec} JSON 提取 markdown（容尾部 banner 噪声）", async () => {
    const md = "# 段一：仪表盘\n\n需求...\n\n```accept\ntest -f x\n```";
    const runner = new StubRunner({ text: `prefix噪声 {"buildSpec": ${JSON.stringify(md)}} \ntokens used: 123`, meta: {} });
    const out = await specToBuildSpec("# 产品 spec\nGherkin...", runner);
    expect(out).toBe(md);
  });

  test("prompt 携带原 spec 文本", () => {
    const p = buildSpecPrompt("我的产品 spec 内容XYZ");
    expect(p).toContain("我的产品 spec 内容XYZ");
    expect(p).toContain("```accept");
  });

  test("agent 无可解析 JSON → 抛错（不静默返回空 spec）", async () => {
    const runner = new StubRunner({ text: "完全没有 JSON 的纯文本", meta: {} });
    await expect(specToBuildSpec("spec", runner)).rejects.toThrow();
  });
});
