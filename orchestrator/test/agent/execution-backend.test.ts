import { describe, expect, test } from "vitest";
import { FakeRunner, type AgentRequest, type AgentResult, type AgentRunner } from "../../src/agent/runner.js";
import {
  LocalExecutionBackend,
  selectExecutionKind,
} from "../../src/agent/execution-backend.js";

const sampleReq: AgentRequest = { stage: "implement", system: "s", input: "i", tools: [] };
const sampleRes: AgentResult = { text: "ok", meta: {} };

describe("selectExecutionKind 纯解析 env", () => {
  test("env 未设 → local", () => {
    expect(selectExecutionKind({})).toBe("local");
  });
  test("KUNPENG_EXECUTION_BACKEND=codex-cloud → codex-cloud", () => {
    expect(selectExecutionKind({ KUNPENG_EXECUTION_BACKEND: "codex-cloud" })).toBe("codex-cloud");
  });
  test("大小写/空白不敏感: ' CODEX-CLOUD ' → codex-cloud", () => {
    expect(selectExecutionKind({ KUNPENG_EXECUTION_BACKEND: " CODEX-CLOUD " })).toBe("codex-cloud");
  });
  test("未知值 → 回退 local", () => {
    expect(selectExecutionKind({ KUNPENG_EXECUTION_BACKEND: "nonsense" })).toBe("local");
  });
});

describe("LocalExecutionBackend 薄委托现有 runner", () => {
  test("kind === 'local'", () => {
    expect(new LocalExecutionBackend(new FakeRunner({})).kind).toBe("local");
  });
  test("run 透传 req 给底层 runner 并回传其结果", async () => {
    const seen: AgentRequest[] = [];
    const spyRunner: AgentRunner = {
      run: async (req) => { seen.push(req); return sampleRes; },
    };
    const out = await new LocalExecutionBackend(spyRunner).run(sampleReq);
    expect(out).toBe(sampleRes);
    expect(seen).toEqual([sampleReq]);
  });
});
