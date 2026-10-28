import { expect, test } from "vitest";
import { formatBriefMd, REQUIRED_FIELDS, validateBrief, type DesignBrief } from "../../src/design/brief-gate.js";

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

test("rejects an empty brief with all required fields missing", () => {
  const result = validateBrief({});

  expect(result.ok).toBe(false);
  expect(result.missing).toEqual(REQUIRED_FIELDS);
});

test("accepts a complete brief with a concrete tone", () => {
  const result = validateBrief(completeBrief());

  expect(result.ok).toBe(true);
  expect(result.missing).toEqual([]);
  expect(result.violations).toEqual([]);
});

test("accepts a complete brief with a reference URL", () => {
  const result = validateBrief(completeBrief({ referenceUrl: "https://x" }));

  expect(result.ok).toBe(true);
});

test("rejects banned empty tone words case-insensitively", () => {
  const result = validateBrief(completeBrief({ tone: "modern and clean dashboard" }));

  expect(result.ok).toBe(false);
  expect(result.violations.length).toBeGreaterThan(0);
  expect(result.violations.some((violation) => violation.includes("modern"))).toBe(true);
});

test("warns when signature is missing without blocking the gate", () => {
  const brief = completeBrief();
  delete brief.signature;

  const result = validateBrief(brief);

  expect(result.ok).toBe(true);
  expect(result.warnings.length).toBeGreaterThan(0);
});

test("formats a bilingual BRIEF markdown with stable field labels and values", () => {
  const brief = completeBrief();
  const md = formatBriefMd(brief);

  expect(md).toContain("设计 BRIEF");
  expect(md).toContain(brief.primaryGoal);
  expect(md).toContain("项目类型");
  expect(md).toContain("Project Type");
});

test("formats reference URL when present", () => {
  const md = formatBriefMd(completeBrief({ referenceUrl: "https://x" }));

  expect(md).toContain("https://x");
});
