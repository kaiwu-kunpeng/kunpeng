import { expect, test } from "vitest";

import { parseAop } from "./aop.js";
import { resolveStepTimeoutMs } from "./aop-timeout.js";

test("步骤声明的预算优先于环境变量", () => {
  expect(resolveStepTimeoutMs(900_000, { KUNPENG_AGENT_STEP_TIMEOUT_MS: "1200000" })).toBe(900_000);
});

test("步骤未声明时落到环境变量", () => {
  expect(resolveStepTimeoutMs(undefined, { KUNPENG_AGENT_STEP_TIMEOUT_MS: "1200000" })).toBe(1_200_000);
});

test("两者都没有时返回 undefined，交给 DEFAULT_TIMEOUT_MS", () => {
  expect(resolveStepTimeoutMs(undefined, {})).toBeUndefined();
});

test("越界或非法的环境变量被忽略", () => {
  expect(resolveStepTimeoutMs(undefined, { KUNPENG_AGENT_STEP_TIMEOUT_MS: "1000" })).toBeUndefined();
  expect(resolveStepTimeoutMs(undefined, { KUNPENG_AGENT_STEP_TIMEOUT_MS: "99999999" })).toBeUndefined();
  expect(resolveStepTimeoutMs(undefined, { KUNPENG_AGENT_STEP_TIMEOUT_MS: "abc" })).toBeUndefined();
});

test("parseAop 保留合法的步骤预算并丢弃越界值", () => {
  const md = [
    "```aop",
    JSON.stringify({
      goal: "g",
      steps: [
        { id: "a", prompt: "p", timeoutMs: 1_200_000 },
        { id: "b", prompt: "p", timeoutMs: 1000 },
        { id: "c", prompt: "p" },
      ],
    }),
    "```",
  ].join("\n");

  const plan = parseAop(md);
  expect(plan?.steps[0].timeoutMs).toBe(1_200_000);
  expect(plan?.steps[1].timeoutMs).toBeUndefined();
  expect(plan?.steps[2].timeoutMs).toBeUndefined();
});