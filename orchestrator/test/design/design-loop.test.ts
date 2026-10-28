import { expect, test } from "vitest";

import { gateDesign, planDesign } from "../../src/design/design-loop.js";
import type { DesignBrief } from "../../src/design/brief-gate.js";

function completeBrief(overrides: Partial<DesignBrief> = {}): DesignBrief {
  return {
    projectType: "研发指挥仪表盘",
    audience: "engineering managers coordinating concurrent worktrees",
    primaryGoal: "surface blocked loops before they miss the integration window",
    tone: "a calm command center, precise and quiet",
    mustHave: ["live loop status", "merge gate evidence", "owner handoff state"],
    forbidden: ["purple gradients", "brutalism", "decorative dashboard cards"],
    techStack: "Next.js, TypeScript, Vitest",
    locale: "both",
    successMetric: "operators can identify the next blocked loop within 10 seconds",
    signature: "compact evidence rail",
    referenceBrands: ["Linear", "Vercel"],
    ...overrides,
  };
}

test("planDesign stops before downstream work when the brief gate fails", () => {
  const plan = planDesign({ brief: {}, seedHex: "#2563eb", baseline: "BASE" });

  expect(plan.ok).toBe(false);
  expect(plan.gate.missing.length).toBeGreaterThan(0);
  expect(plan.systemPrompt).toBeUndefined();
  expect(plan.tokens).toBeUndefined();
});

test("planDesign builds tokens, brief markdown, and prompt when the brief gate passes without anchors", () => {
  const plan = planDesign({
    brief: completeBrief(),
    seedHex: "#2563eb",
    baseline: "BASE",
  });

  expect(plan.ok).toBe(true);
  expect(plan.briefMd).toContain("设计 BRIEF");
  expect(plan.tokens).toHaveProperty("light");
  expect(plan.systemPrompt).toContain("BASE");
  expect(plan.systemPrompt).toContain("#F4F1EA");
  expect(plan.chosenAnchor).toBeUndefined();
  expect(plan.chosenFonts).toBeUndefined();
  expect(plan.brandName).toBeUndefined();
});

test("planDesign injects brand context and returns the brand name when provided", () => {
  const plan = planDesign({
    brief: completeBrief(),
    seedHex: "#2563eb",
    baseline: "BASE",
    brand: {
      name: "鲲鹏",
      archetypeId: "ruler",
      mission: "做研发底座",
      pillars: ["自主", "精密"],
      tone: {
        funnySerious: 1,
        casualFormal: 1,
        irreverentRespectful: 1,
        enthusiasticMatter: 1,
      },
      neverSay: ["赋能"],
    },
  });

  expect(plan.ok).toBe(true);
  expect(plan.brandName).toBe("鲲鹏");
  expect(plan.systemPrompt).toContain("鲲鹏");
  expect(plan.systemPrompt).toContain("赋能");
  expect(plan.systemPrompt).toContain("掌控");
});

test("planDesign ranks anchors by same-bucket history and uses the winner's locked anchor description in the prompt", () => {
  const plan = planDesign({
    brief: completeBrief(),
    seedHex: "#2563eb",
    baseline: "BASE",
    anchors: ["Organic", "Swiss"],
    bucket: "b1",
    history: [
      { bucket: "b1", anchor: "Swiss", won: true },
      { bucket: "b1", anchor: "Swiss", won: true },
    ],
  });

  expect(plan.ok).toBe(true);
  expect(plan.chosenAnchor).toBe("Swiss");
  expect(plan.rankedAnchors?.[0]).toBe("Swiss");
  expect(plan.chosenFonts?.display).toBe("Inter Tight");
  expect(plan.chosenFonts?.body).toBe("Inter");
  expect(plan.systemPrompt).toContain("Swiss");
  expect(plan.systemPrompt).toContain("Inter Tight");
  expect(plan.systemPrompt).toContain("混搭");
});

test("planDesign falls back to the raw anchor name when the chosen anchor is unknown", () => {
  const plan = planDesign({
    brief: completeBrief(),
    seedHex: "#2563eb",
    baseline: "BASE",
    anchors: ["不存在锚"],
  });

  expect(plan.ok).toBe(true);
  expect(plan.chosenAnchor).toBe("不存在锚");
  expect(plan.chosenFonts).toBeUndefined();
  expect(plan.systemPrompt).toContain("不存在锚");
});

test("planDesign includes brief reference URL and notes in the system prompt", () => {
  const plan = planDesign({
    brief: completeBrief({ referenceUrl: "https://ref", referenceNotes: "暗色克制" }),
    seedHex: "#2563eb",
    baseline: "B",
  });

  expect(plan.ok).toBe(true);
  expect(plan.systemPrompt).toContain("https://ref");
  expect(plan.systemPrompt).toContain("暗色克制");
});

test("gateDesign blocks only P0 lint hits", () => {
  const blocked = gateDesign({ css: "body{background:#F4F1EA;font-family:Georgia,serif}" });
  const passed = gateDesign({ css: ":root{--p:#2563eb}" });

  expect(blocked.pass).toBe(false);
  expect(blocked.lint.counts.P0).toBeGreaterThanOrEqual(1);
  expect(passed.pass).toBe(true);
});
