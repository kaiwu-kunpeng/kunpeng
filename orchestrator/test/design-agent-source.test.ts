import { expect, test } from "vitest";
import type { AgentRequest, AgentResult, AgentRunner } from "../src/agent/runner.js";
import { FakeRunner } from "../src/agent/runner.js";
import type { DesignContract } from "../src/design/contract.js";
import { AgentDesignSource } from "../src/design/agent-source.js";

/** 一份合法契约 JSON 文本，供 runner 回放。 */
function contractText(over: Partial<DesignContract> = {}): string {
  return JSON.stringify({
    source: "agent:custom",
    anchor: "shadcn/ui + Geist",
    tokens: {
      colors: { background: "#fff" },
      spacing: { md: "16px" },
      typography: { sans: "Geist" },
    },
    components: ["Button", "Card"],
    ...over,
  });
}

/** 录下最后一次请求、回放预设文本的 runner（探针）。 */
function spyRunner(text: string): { runner: AgentRunner; last(): AgentRequest | undefined } {
  let captured: AgentRequest | undefined;
  const runner: AgentRunner = {
    async run(req: AgentRequest): Promise<AgentResult> {
      captured = req;
      return { text, meta: {} };
    },
  };
  return { runner, last: () => captured };
}

test("name 透传 opts.name", () => {
  const src = new AgentDesignSource({
    name: "figma:abc",
    runner: new FakeRunner({}),
    styleBrief: "干净白底",
  });
  expect(src.name).toBe("figma:abc");
});

test("resolve 以 stage:design、tools、内嵌 planMd 的提示调 runner.run", async () => {
  const { runner, last } = spyRunner(contractText());
  const src = new AgentDesignSource({
    name: "agent:x",
    runner,
    styleBrief: "干净白底",
    tools: ["websearch", "browser"],
  });

  await src.resolve({ planMd: "PLAN_MARKER_42" });

  const req = last();
  expect(req?.stage).toBe("design");
  expect(req?.tools).toEqual(["websearch", "browser"]);
  expect(req?.input).toContain("PLAN_MARKER_42");
});

test("opts.tools 省略时传空数组", async () => {
  const { runner, last } = spyRunner(contractText());
  const src = new AgentDesignSource({ name: "agent:x", runner, styleBrief: "b" });

  await src.resolve({});

  expect(last()?.tools).toEqual([]);
});

test("解析成功 → source 取契约 source，components 透传", async () => {
  const runner = new FakeRunner({
    design: { text: contractText({ source: "agent:custom", components: ["Button", "Card", "Tabs"] }), meta: {} },
  });
  const src = new AgentDesignSource({ name: "agent:fallback", runner, styleBrief: "b" });

  const cand = await src.resolve({});

  expect(cand.source).toBe("agent:custom");
  expect(cand.contract.source).toBe("agent:custom");
  expect(cand.contract.components).toEqual(["Button", "Card", "Tabs"]);
});

test("契约缺 source → 兜底为 opts.name", async () => {
  const runner = new FakeRunner({
    design: { text: JSON.stringify({ anchor: "x", tokens: {}, components: ["Button"] }), meta: {} },
  });
  const src = new AgentDesignSource({ name: "agent:fallback", runner, styleBrief: "b" });

  const cand = await src.resolve({});

  expect(cand.source).toBe("agent:fallback");
  expect(cand.contract.source).toBe("agent:fallback");
});

test("解析为 null 时不抛错，返回最小契约（anchor=styleBrief、空 tokens、空 components）", async () => {
  const runner = new FakeRunner({ design: { text: "not json at all", meta: {} } });
  const src = new AgentDesignSource({ name: "agent:fb", runner, styleBrief: "MY_STYLE_BRIEF" });

  const cand = await src.resolve({});

  expect(cand.contract.anchor).toBe("MY_STYLE_BRIEF");
  expect(cand.contract.tokens.colors).toEqual({});
  expect(cand.contract.tokens.spacing).toEqual({});
  expect(cand.contract.tokens.typography).toEqual({});
  expect(cand.contract.components).toEqual([]);
});
