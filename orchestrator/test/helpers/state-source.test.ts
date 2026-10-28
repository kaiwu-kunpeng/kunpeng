import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { stateSource } from "./state-source.js";

const here = dirname(fileURLToPath(import.meta.url));

describe("stateSource helper", () => {
  it("包含 state.ts 全部源码与 state-* 叶子", () => {
    const raw = readFileSync(join(here, "..", "..", "src", "server", "state.ts"), "utf8");
    const combined = stateSource();
    expect(combined.startsWith(raw)).toBe(true);
    expect(combined).toContain("collectState");
    expect(combined).toContain("slimFlowsForDashboard");
  });
});