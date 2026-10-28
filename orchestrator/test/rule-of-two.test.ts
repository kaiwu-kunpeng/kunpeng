import { expect, test } from "vitest";
import { ruleOfTwo, type ActionContext } from "../src/security/rule-of-two.js";

const emptyContext: ActionContext = {
  untrustedInput: false,
  sensitiveAccess: false,
  externalEgress: false,
};

test("returns safe verdict when no risky dimensions are present", () => {
  const verdict = ruleOfTwo(emptyContext);

  expect(verdict.count).toBe(0);
  expect(verdict.dimensions).toEqual([]);
  expect(verdict.safe).toBe(true);
  expect(verdict.requiresHumanGate).toBe(false);
  expect(verdict.reason).toContain("占 0/3 项");
  expect(verdict.reason).toContain("在 Rule of Two 边界内");
});

test("counts each single risky dimension independently", () => {
  const cases: Array<{ dimension: keyof ActionContext; expected: string[] }> = [
    { dimension: "untrustedInput", expected: ["untrustedInput"] },
    { dimension: "sensitiveAccess", expected: ["sensitiveAccess"] },
    { dimension: "externalEgress", expected: ["externalEgress"] },
  ];

  for (const { dimension, expected } of cases) {
    const verdict = ruleOfTwo({ ...emptyContext, [dimension]: true });

    expect(verdict.count).toBe(1);
    expect(verdict.dimensions).toEqual(expected);
    expect(verdict.safe).toBe(true);
    expect(verdict.requiresHumanGate).toBe(false);
    expect(verdict.reason).toContain("占 1/3 项");
    expect(verdict.reason).toContain("在 Rule of Two 边界内");
  }
});

test("keeps all two-dimension combinations inside the Rule of Two boundary", () => {
  const cases: Array<{ ctx: ActionContext; expected: string[] }> = [
    {
      ctx: { untrustedInput: true, sensitiveAccess: true, externalEgress: false },
      expected: ["untrustedInput", "sensitiveAccess"],
    },
    {
      ctx: { untrustedInput: true, sensitiveAccess: false, externalEgress: true },
      expected: ["untrustedInput", "externalEgress"],
    },
    {
      ctx: { untrustedInput: false, sensitiveAccess: true, externalEgress: true },
      expected: ["sensitiveAccess", "externalEgress"],
    },
  ];

  for (const { ctx, expected } of cases) {
    const verdict = ruleOfTwo(ctx);

    expect(verdict.count).toBe(2);
    expect(verdict.dimensions).toEqual(expected);
    expect(verdict.safe).toBe(true);
    expect(verdict.requiresHumanGate).toBe(false);
    expect(verdict.reason).toContain("占 2/3 项");
    expect(verdict.reason).toContain("在 Rule of Two 边界内");
  }
});

test("requires human gate when all three risky dimensions are present", () => {
  const verdict = ruleOfTwo({
    untrustedInput: true,
    sensitiveAccess: true,
    externalEgress: true,
  });

  expect(verdict.count).toBe(3);
  expect(verdict.dimensions).toEqual(["untrustedInput", "sensitiveAccess", "externalEgress"]);
  expect(verdict.safe).toBe(false);
  expect(verdict.requiresHumanGate).toBe(true);
  expect(verdict.reason).toContain("强制人工门");
});

test("does not mutate the input context", () => {
  const ctx: ActionContext = {
    untrustedInput: true,
    sensitiveAccess: false,
    externalEgress: true,
  };

  ruleOfTwo(ctx);

  expect(ctx).toEqual({
    untrustedInput: true,
    sensitiveAccess: false,
    externalEgress: true,
  });
});
