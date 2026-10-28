import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { projectViewsSource } from "../helpers/project-views-source.js";

function hexCountOf(src: string): number {
  return (src.match(/#[0-9a-fA-F]{6}\b/g) ?? []).length + (src.match(/#[0-9a-fA-F]{3}\b(?![0-9a-fA-F])/g) ?? []).length;
}

function hexCount(path: string): number {
  return hexCountOf(readFileSync(path, "utf8"));
}

describe("views 硬编码清零", () => {
  it("overview/evolution/settings/project 零 hex", () => {
    expect(hexCount("src/server/ui/views/overview.ts")).toBe(0);
    expect(hexCount("src/server/ui/views/evolution.ts")).toBe(0);
    expect(hexCount("src/server/ui/views/settings.ts")).toBe(0);
    expect(hexCountOf(projectViewsSource())).toBe(0);
  });

  it("workbench 只剩红绿灯三色，字体栈归 token", () => {
    const src = readFileSync("src/server/ui/workbench-panel.ts", "utf8");
    const hexes = src.match(/#[0-9a-fA-F]{6}\b/g) ?? [];
    expect(hexes.length).toBeLessThanOrEqual(3);
    expect(src.includes("var(--info,")).toBe(false);
    expect(src).toContain("var(--sans)");
    expect(src).toContain("var(--mono)");
    expect(src.split("-apple-system").length - 1).toBeLessThanOrEqual(0);
  });
});
