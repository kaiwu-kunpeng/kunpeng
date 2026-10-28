import { expect, test } from "vitest";
import type { AgentRunner } from "../src/agent/runner.js";
import {
  autoDefineProduct,
  buildAutoDefinePrompt,
} from "../src/product/auto-define.js";

const json = '{"problem":"P","users":["U1","U2"],"stories":["S1"],"acceptance":["A1","A2"]}';

function fakeRunner(output: unknown): AgentRunner {
  return { run: async () => output } as AgentRunner;
}

function capturingRunner(output: unknown): { runner: AgentRunner; inputs: string[] } {
  const inputs: string[] = [];
  return {
    inputs,
    runner: {
      run: async (request) => {
        inputs.push(request.input);
        expect(request.stage).toBe("spec");
        expect(request.system).toBe("");
        expect(request.tools).toEqual([]);
        return output;
      },
    } as AgentRunner,
  };
}

test("product-auto-define turns one sentence into a PR FAQ product definition without interview questions", async () => {
  const definition = await autoDefineProduct("做个待办", fakeRunner(json));

  expect(definition).toEqual({
    idea: "做个待办",
    problem: "P",
    jobStatement: "",
    users: ["U1", "U2"],
    stories: ["S1"],
    acceptance: ["A1", "A2"],
    nonGoals: [],
  });
});

test("product-auto-define prompt carries the one sentence and fixed PR FAQ anchors", async () => {
  const fake = capturingRunner(json);

  await autoDefineProduct("做个待办", fake.runner);

  expect(fake.inputs).toHaveLength(1);
  expect(fake.inputs[0]).toContain("一句话产品想法：做个待办");
  expect(fake.inputs[0]).toContain("不要反问用户");
  expect(fake.inputs[0]).toContain("[prfaq-problem] 问题");
  expect(fake.inputs[0]).toContain("[prfaq-users] 目标用户");
  expect(fake.inputs[0]).toContain("[prfaq-scenarios] 核心场景");
  expect(fake.inputs[0]).toContain("[prfaq-success] 成功标准");
  expect(fake.inputs[0]).toContain("[prfaq-non-goals] 非目标");
});

test("product-auto-define extracts JSON from noisy runner output", async () => {
  const definition = await autoDefineProduct("做个待办", fakeRunner(`解释\n${json}\n后续`));

  expect(definition.problem).toBe("P");
  expect(definition.users).toEqual(["U1", "U2"]);
});

test("product-auto-define rejects output without a JSON object", async () => {
  await expect(autoDefineProduct("做个待办", fakeRunner("not json"))).rejects.toThrow(
    "autoDefineProduct: 无法从 agent 输出解析产品定义",
  );
});

test("product-auto-define retries once when the first parse fails and the second succeeds", async () => {
  let calls = 0;
  const runner = {
    run: async () => {
      calls += 1;
      if (calls === 1) return { text: "这不是JSON {坏", meta: {} };
      return { text: '{"problem":"p","users":["u"],"stories":["s"],"acceptance":["a"]}', meta: {} };
    },
  } as AgentRunner;

  const definition = await autoDefineProduct("idea", runner);

  expect(definition.problem).toBe("p");
  expect(calls).toBe(2);
});

test("product-auto-define stops after two parse failures and throws", async () => {
  let calls = 0;
  const runner = {
    run: async () => {
      calls += 1;
      return { text: "no json here", meta: {} };
    },
  } as AgentRunner;

  await expect(autoDefineProduct("idea", runner)).rejects.toThrow(
    "autoDefineProduct: 无法从 agent 输出解析产品定义",
  );
  expect(calls).toBe(2);
});

test("product-auto-define does not retry after the first parse succeeds", async () => {
  let calls = 0;
  const runner = {
    run: async () => {
      calls += 1;
      return { text: '{"problem":"p","users":["u"],"stories":["s"],"acceptance":["a"]}', meta: {} };
    },
  } as AgentRunner;

  const definition = await autoDefineProduct("idea", runner);

  expect(definition.problem).toBe("p");
  expect(calls).toBe(1);
});

test("buildAutoDefinePrompt is deterministic", () => {
  expect(buildAutoDefinePrompt("做个待办")).toBe(buildAutoDefinePrompt("做个待办"));
});
