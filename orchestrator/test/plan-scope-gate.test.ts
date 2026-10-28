import { expect, test } from "vitest";
import { planScopeViolations } from "../src/plan/orchestrator.js";

test("reports forbidden path violations from a plan scope declaration", () => {
  const specText = [
    "# Spec",
    "",
    "```scope",
    "forbid: src/core/**",
    "```",
  ].join("\n");

  const result = planScopeViolations(specText, ["src/core/x.ts", "src/ok/y.ts"]);

  expect(result).toContainEqual({ file: "src/core/x.ts", rule: "forbidden" });
  expect(result.some((v) => v.file === "src/ok/y.ts")).toBe(false);
});

test("returns no violations when the plan has no scope declaration", () => {
  const result = planScopeViolations("# Spec\n\nNo scope here.", ["src/core/x.ts"]);

  expect(result).toEqual([]);
});

test("reports files outside an allow list from a plan scope declaration", () => {
  const specText = [
    "# Spec",
    "",
    "```scope",
    "allow: src/a/**",
    "```",
  ].join("\n");

  const result = planScopeViolations(specText, ["src/b/z.ts"]);

  expect(result).toContainEqual({ file: "src/b/z.ts", rule: "outside-allow" });
});
