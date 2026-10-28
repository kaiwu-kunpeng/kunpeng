import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { httpSource } from "./http-source.js";

const here = dirname(fileURLToPath(import.meta.url));

describe("httpSource helper", () => {
  it("包含 http.ts 全部源码与 routes 模块", () => {
    const raw = readFileSync(join(here, "..", "..", "src", "server", "http.ts"), "utf8");
    const combined = httpSource();
    expect(combined.startsWith(raw)).toBe(true);
    expect(combined).toContain("registerModularRoute");
    expect(combined).toContain("/api/product/list");
  });
});