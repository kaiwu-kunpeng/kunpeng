import { expect, test } from "vitest";
import { AgentResearcher } from "../src/research/researcher.js";
import { FakeRunner } from "../src/agent/runner.js";

test("解析后端返回的合法 JSON 数组为 ResearchFinding[]", async () => {
  const finding = {
    topic: "t",
    source: "https://x.com",
    summary: "一句话摘要",
    suggestedConvention: "建议的约定",
  };
  const runner = new FakeRunner({
    spec: { text: JSON.stringify([finding]), meta: {} },
  });

  const findings = await new AgentResearcher(runner).research("t");

  expect(findings).toHaveLength(1);
  expect(findings[0].source).toBe("https://x.com");
});

test("后端返回非 JSON 文本时返回空数组，不抛异常", async () => {
  const runner = new FakeRunner({
    spec: { text: "not json at all", meta: {} },
  });

  await expect(new AgentResearcher(runner).research("t")).resolves.toEqual([]);
});

test("后端在 JSON 数组前后夹带 prose/banner 噪声时仍能抠出并解析", async () => {
  const finding = { topic: "t", source: "https://x.com", summary: "摘要" };
  const noisy =
    `根据调研，结论整理如下：\n` +
    `${JSON.stringify([finding])}\n` +
    `（以上基于公开来源）tokens used: 1234`;
  const runner = new FakeRunner({ spec: { text: noisy, meta: {} } });

  const findings = await new AgentResearcher(runner).research("t");
  expect(findings).toHaveLength(1);
  expect(findings[0].source).toBe("https://x.com");
});
