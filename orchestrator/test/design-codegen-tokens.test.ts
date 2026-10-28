import { expect, test } from "vitest";
import type { DesignContract } from "../src/design/contract.js";
import { renderTokensCss, renderTailwindTheme } from "../src/design/codegen-tokens.js";

const c: DesignContract = {
  source: "house:neutral",
  anchor: "shadcn/ui + Geist (slate)",
  tokens: {
    colors: { background: "#f8fafc", primary: "#0f172a" },
    spacing: { md: "1rem" },
    typography: { sans: "Geist" },
  },
  components: ["Button", "Card"],
};

test("renderTokensCss emits :root CSS vars grouped by token kind + anchor comment", () => {
  const css = renderTokensCss(c);
  expect(css).toContain("/* shadcn/ui + Geist (slate) */");
  expect(css).toContain(":root");
  expect(css).toContain("--color-background: #f8fafc;");
  expect(css).toContain("--space-md: 1rem;");
  expect(css).toContain("--font-sans: Geist;");
});

test("renderTailwindTheme emits a Tailwind v4 @theme block", () => {
  const theme = renderTailwindTheme(c);
  expect(theme).toContain("@theme");
  expect(theme).toContain("--color-background: #f8fafc;");
});
