import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("求助卡点接线（作者锁定）", () => {
  it("resume 清求助卡点并提醒未回复", () => {
    const src = read("../../src/cli-commands/devcycle.ts");
    expect(src).toContain("isRaiseBlocker(");
    expect(src).toContain("尚未回复求助");
  });

  it("客户端有 reply-blocker：先 /api/feedback 再 /api/resume", () => {
    const src = read("../../src/server/ui/client-parts/part07.ts");
    const at = src.indexOf('"reply-blocker"');
    expect(at).toBeGreaterThan(-1);
    const block = src.slice(at, at + 2500);
    expect(block).toContain("/api/feedback");
    expect(block).toContain("/api/resume");
    expect(block.indexOf("/api/feedback")).toBeLessThan(block.indexOf("/api/resume"));
    expect(block).toContain("data-kp-reply-input");
  });

  it("dev-cycle 两处（implement 与 repair）都走求助判定，且不改 flowstate 结构", () => {
    const src = read("../../src/loop/dev-cycle.ts");
    expect(src).toContain("RAISE_BLOCKER_INSTRUCTION");
    expect(src).toContain("parseRaiseBlocker(");
    expect(src).toContain("RAISE_BLOCKER_PREFIX");
    expect(read("../../src/runtime/flowstate.ts")).not.toContain("raise-blocker");
  });
});