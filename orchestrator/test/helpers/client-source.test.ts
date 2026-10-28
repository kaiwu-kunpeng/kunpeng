import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { clientSource } from "./client-source.js";

const here = dirname(fileURLToPath(import.meta.url));

describe("clientSource helper", () => {
  it("包含 client.ts 全部源码(分段前等价)", () => {
    const raw = readFileSync(join(here, "..", "..", "src", "server", "ui", "client.ts"), "utf8");
    const combined = clientSource();
    expect(combined.startsWith(raw)).toBe(true);
    expect(combined).toContain("export const clientScript");
  });
});