import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { wrapUntrusted } from "../../src/security/prompt-shield.js";

const src = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");

describe("P5 wrapUntrusted 接线", () => {
  it("栅栏格式含来源与非指令标记", () => {
    const wrapped = wrapUntrusted("url:https://x", "正文");
    expect(wrapped).toContain("不可信数据");
    expect(wrapped).toContain("url:https://x");
    expect(wrapped).toContain("非指令");
  });

  it("knowledge organize 与 ears-research 都已包裹", () => {
    const knowledge = readFileSync(join(src, "server", "routes", "knowledge.ts"), "utf8");
    const ears = readFileSync(join(src, "evolution", "ears-research.ts"), "utf8");
    expect(knowledge).toContain("wrapUntrusted");
    expect(knowledge).toMatch(/input:\s*wrapUntrusted\(/);
    expect(ears).toContain("wrapUntrusted");
  });
});