import { expect, test } from "vitest";
import {
  CLAUDE_TIER,
  CODEX_TIER,
  routeForStage,
} from "../src/agent/model-routing.js";
import type { Stage } from "../src/agent/runner.js";

const STAGES: Stage[] = [
  "spec",
  "design",
  "implement",
  "review",
  "verify",
  "audit",
];

// claude tier：全阶段 Opus 5（2026-09-07 用户指定升级；省 token 走缓存/effort 不降主链模型）
test("claude: 全部 stage → claude-opus-5", () => {
  for (const stage of STAGES) {
    expect(routeForStage(stage, "claude").model).toBe("claude-opus-5");
  }
});

// codex effort 档
test("codex: spec → effort low", () => {
  expect(routeForStage("spec", "codex").effort).toBe("low");
});

test("codex: implement（写代码）→ effort xhigh", () => {
  expect(routeForStage("implement", "codex").effort).toBe("xhigh");
});

test("codex: 非 implement 的 stage 都是 low", () => {
  for (const stage of STAGES) {
    if (stage === "implement") continue;
    expect(routeForStage(stage, "codex").effort).toBe("low");
  }
});

test("codex 档不带 model 别名", () => {
  expect(routeForStage("implement", "codex").model).toBeUndefined();
  for (const stage of STAGES) {
    expect(routeForStage(stage, "codex").model).toBeUndefined();
  }
});

// 表与函数一致
test("routeForStage 与 CLAUDE_TIER / CODEX_TIER 一致", () => {
  for (const stage of STAGES) {
    expect(routeForStage(stage, "claude")).toEqual(CLAUDE_TIER[stage]);
    expect(routeForStage(stage, "codex")).toEqual(CODEX_TIER[stage]);
  }
});

// 两张表覆盖全部 stage
test("CLAUDE_TIER / CODEX_TIER 覆盖全部 6 个 stage", () => {
  expect(Object.keys(CLAUDE_TIER).sort()).toEqual([...STAGES].sort());
  expect(Object.keys(CODEX_TIER).sort()).toEqual([...STAGES].sort());
});