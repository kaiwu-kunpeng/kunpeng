import { describe, expect, it } from "vitest";
import { measureDistFreshness } from "../../src/runtime/dist-freshness.js";

describe("measureDistFreshness（作者锁定）", () => {
  it("dist 比最近 src 提交旧超过容差 → stale；缺省路径与注入的 git/stat 一致", async () => {
    const calls: string[][] = [];
    const f = await measureDistFreshness({
      repoRoot: "/r",
      git: async (args) => { calls.push(args); return "1700000000\n"; },
      statMtimeMs: async (p) => { expect(p).toBe("/r/orchestrator/dist/cli.js"); return 1_699_990_000_000; },
    });
    expect(f).toEqual({ stale: true, builtAt: 1_699_990_000_000, committedAt: 1_700_000_000_000, behindMs: 10_000_000 });
    expect(calls[0]).toEqual(["-C", "/r", "log", "-1", "--format=%ct", "--", "orchestrator/src"]);
  });

  it("dist 更新 → 不 stale；dist 缺失或 git 失败/为空 → undefined", async () => {
    const fresh = await measureDistFreshness({ repoRoot: "/r", git: async () => "1700000000", statMtimeMs: async () => 1_700_000_500_000 });
    expect(fresh?.stale).toBe(false);
    expect(await measureDistFreshness({ repoRoot: "/r", git: async () => "1700000000", statMtimeMs: async () => { throw new Error("ENOENT"); } })).toBeUndefined();
    expect(await measureDistFreshness({ repoRoot: "/r", git: async () => { throw new Error("not a repo"); }, statMtimeMs: async () => 1 })).toBeUndefined();
    expect(await measureDistFreshness({ repoRoot: "/r", git: async () => "", statMtimeMs: async () => 1 })).toBeUndefined();
  });
});