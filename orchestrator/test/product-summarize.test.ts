import { expect, test } from "vitest";
import type { AgentRunner } from "../src/agent/runner.js";
import type { InterviewSession } from "../src/product/contract.js";
import { completeInterview, summarizeDefinition } from "../src/product/summarize.js";

const session: InterviewSession = {
  idea: "做个待办",
  status: "in-progress",
  step: 5,
  answers: ["P answer", "U answer", "S answer", "A answer", "N answer"],
};

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
        return output;
      },
    } as AgentRunner,
  };
}

test("summarizeDefinition turns fake runner JSON into a product definition", async () => {
  const definition = await summarizeDefinition(session, fakeRunner(json));

  expect(definition.idea).toBe(session.idea);
  expect(definition.problem).toBe("P");
  expect(definition.users).toEqual(["U1", "U2"]);
  expect(definition.stories).toEqual(["S1"]);
  expect(definition.acceptance).toEqual(["A1", "A2"]);
});

test("summarizeDefinition prompt carries PR FAQ anchors", async () => {
  const fake = capturingRunner(json);

  await summarizeDefinition(session, fake.runner);

  expect(fake.inputs).toHaveLength(1);
  expect(fake.inputs[0]).toContain("[prfaq-problem] 问题");
  expect(fake.inputs[0]).toContain("[prfaq-users] 目标用户");
  expect(fake.inputs[0]).toContain("[prfaq-scenarios] 核心场景");
  expect(fake.inputs[0]).toContain("[prfaq-success] 成功标准");
  expect(fake.inputs[0]).toContain("[prfaq-non-goals] 非目标");
  expect(fake.inputs[0]).toContain("答：P answer");
});

test("summarizeDefinition extracts JSON from noisy agent output", async () => {
  const definition = await summarizeDefinition(
    session,
    fakeRunner(`解释文字\n${json}\n后续文字`),
  );

  expect(definition.problem).toBe("P");
  expect(definition.users).toEqual(["U1", "U2"]);
});

test("summarizeDefinition ignores codex tokens banner after JSON", async () => {
  const definition = await summarizeDefinition(
    session,
    fakeRunner('{"problem":"P","users":["U"],"stories":["S"],"acceptance":["A1"]}\ntokens used\n15,109\n'),
  );

  expect(definition.problem).toBe("P");
  expect(definition.acceptance).toEqual(["A1"]);
});

test("summarizeDefinition keeps braces inside JSON string values", async () => {
  const definition = await summarizeDefinition(
    session,
    fakeRunner('{"problem":"判断 if(x){y}","users":[],"stories":[],"acceptance":["o.some(x=>{return x})"]}'),
  );

  expect(definition.problem).toBe("判断 if(x){y}");
  expect(definition.acceptance).toEqual(["o.some(x=>{return x})"]);
});

test("summarizeDefinition uses the first complete JSON object", async () => {
  const definition = await summarizeDefinition(
    session,
    fakeRunner('{"problem":"first","users":[],"stories":[],"acceptance":[]}{"problem":"second"}'),
  );

  expect(definition.problem).toBe("first");
});

test("summarizeDefinition parses JSON after log prefix", async () => {
  const definition = await summarizeDefinition(
    session,
    fakeRunner('log line\n{"problem":"P","users":[],"stories":[],"acceptance":[]}'),
  );

  expect(definition.problem).toBe("P");
});

test("summarizeDefinition rejects output without a JSON object", async () => {
  await expect(summarizeDefinition(session, fakeRunner("not json"))).rejects.toThrow(
    "summarizeDefinition: 无法从 agent 输出解析产品定义",
  );
});

test("completeInterview returns a done copy without mutating the original session", async () => {
  const completed = await completeInterview(session, fakeRunner(json));

  expect(completed.status).toBe("done");
  expect(completed.definition).toBeDefined();
  expect(completed.definition?.problem).toBe("P");
  expect(session.status).toBe("in-progress");
  expect(session.definition).toBeUndefined();
});
