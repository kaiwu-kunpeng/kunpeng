import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FlowTracker,
  resetSkippedStateFileWarnings,
  shouldWarnSkippedStateFile,
} from "../../src/runtime/flowstate.js";

const roots: string[] = [];

function temp(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix));
  roots.push(path);
  return path;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("shouldWarnSkippedStateFile", () => {
  it("同一路径只放行一次，不同路径互不影响，reset 后重新放行", () => {
    resetSkippedStateFileWarnings();
    expect(shouldWarnSkippedStateFile("/s/a.json")).toBe(true);
    expect(shouldWarnSkippedStateFile("/s/a.json")).toBe(false);
    expect(shouldWarnSkippedStateFile("/s/a.json")).toBe(false);
    expect(shouldWarnSkippedStateFile("/s/b.json")).toBe(true);
    expect(shouldWarnSkippedStateFile("/s/b.json")).toBe(false);
    resetSkippedStateFileWarnings();
    expect(shouldWarnSkippedStateFile("/s/a.json")).toBe(true);
  });
});

describe("FlowTracker.list 反刷屏（2026-08-06 710MB 日志回归）", () => {
  it("已知非流对象静默跳过，未知非流文件汇总成一行且每进程只报一次，真流每次都读到", async () => {
    const dir = temp("kp-flowstate-warn-");
    const tracker = new FlowTracker(dir);
    await tracker.start("flow-real", "需求");
    writeFileSync(join(dir, "fitness-baseline.json"), JSON.stringify({ generatedAt: 1 }), "utf8");
    writeFileSync(join(dir, "maintenance-ledger.json"), JSON.stringify({ entries: [] }), "utf8");
    writeFileSync(join(dir, "mystery-a.json"), JSON.stringify({ nope: 1 }), "utf8");
    writeFileSync(join(dir, "mystery-b.json"), JSON.stringify({ nope: 2 }), "utf8");

    resetSkippedStateFileWarnings();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect((await tracker.list()).map((f) => f.flowId)).toEqual(["flow-real"]);
      expect((await tracker.list()).map((f) => f.flowId)).toEqual(["flow-real"]);
      expect((await tracker.list()).map((f) => f.flowId)).toEqual(["flow-real"]);
      expect(warn).toHaveBeenCalledTimes(1);
      const warned = warn.mock.calls.map((c) => String(c[0])).join("\n");
      expect(warned).toContain("2 个非流状态文件");
      expect(warned).toContain("mystery-a.json");
      expect(warned).not.toContain("fitness-baseline.json");
      expect(warned).not.toContain("maintenance-ledger.json");
    } finally {
      warn.mockRestore();
    }
  });
});