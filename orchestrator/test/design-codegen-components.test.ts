import { expect, test } from "vitest";
import { renderComponentSample, renderComponentSamples } from "../src/design/codegen-components.js";
import { renderStarterPage } from "../src/design/codegen-scaffold.js";
import type { DesignContract } from "../src/design/contract.js";

test("renderComponentSample renders known component structures", () => {
  expect(renderComponentSample("Button")).toContain("<button");
  expect(renderComponentSample("Button")).toContain('type="button"');
  expect(renderComponentSample("input")).toContain("<input");
  expect(renderComponentSample("input")).toContain("<label");
  expect(renderComponentSample("Card")).toContain("<article");
  expect(renderComponentSample("Card")).toContain("<h3");
  expect(renderComponentSample("dialog")).toContain('role="dialog"');
  expect(renderComponentSample("checkbox")).toContain('type="checkbox"');
  expect(renderComponentSample("checkbox")).toContain("<label");
});

test("renderComponentSample falls back to escaped section for unknown names", () => {
  const sample = renderComponentSample("Frobnicator");
  expect(sample).toContain("Frobnicator");
  expect(sample).toContain("<section");
  expect(renderComponentSample("<Frobnicator>")).toContain("&lt;Frobnicator&gt;");
});

test("renderComponentSample uses token variables in every known and fallback sample", () => {
  const names = ["button", "input", "card", "dialog", "tabs", "badge", "alert", "checkbox", "Frobnicator"];

  for (const name of names) {
    expect(renderComponentSample(name)).toContain("var(--");
  }
});

test("renderComponentSamples preserves order and joins samples", () => {
  const samples = renderComponentSamples(["Button", "Input"]);
  expect(samples).toContain("<button");
  expect(samples).toContain("<input");
  expect(samples.indexOf("<button")).toBeLessThan(samples.indexOf("<input"));
});

test("renderStarterPage wraps component samples in complete accessible HTML", () => {
  const c: DesignContract = {
    source: "house:stone",
    anchor: "shadcn/ui + Geist (stone)",
    tokens: {
      colors: { background: "#fafaf9", foreground: "#1c1917", primary: "#44403c" },
      spacing: { xs: "0.25rem", sm: "0.5rem", md: "1rem" },
      typography: { sans: "Geist, sans-serif" },
    },
    components: ["Button", "Input", "Card"],
  };

  const html = renderStarterPage(c);
  expect(html).toContain("<html lang=");
  expect(html).toContain("<main");
  expect(html).toContain("<title");
  expect(html).toContain("<h1");
  expect(html).toContain("--color-background");
  expect(html).toContain("Button");
  expect(html).toContain("Input");
  expect(html).toContain("Card");
});
