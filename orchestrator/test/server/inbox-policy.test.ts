import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_INBOX_POLICY, loadInboxPolicy, saveInboxPolicy } from "../../src/server/inbox-policy.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kp-inbox-policy-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("收件箱策略文件（作者锁定）", () => {
  it("缺失/损坏 → 默认 5 条、168 小时；坏值回默认；absence 只认有限 until", () => {
    expect(DEFAULT_INBOX_POLICY).toEqual({ dailyHardCapPerProject: 5, gateTtlHours: 168 });
    expect(loadInboxPolicy(join(dir, "nope.json"))).toEqual(DEFAULT_INBOX_POLICY);
    writeFileSync(join(dir, "bad.json"), "{not json", "utf8");
    expect(loadInboxPolicy(join(dir, "bad.json"))).toEqual(DEFAULT_INBOX_POLICY);
    writeFileSync(join(dir, "p.json"), JSON.stringify({ dailyHardCapPerProject: 0, gateTtlHours: "x", absence: { until: "soon" } }), "utf8");
    expect(loadInboxPolicy(join(dir, "p.json"))).toEqual(DEFAULT_INBOX_POLICY);
    writeFileSync(join(dir, "q.json"), JSON.stringify({ dailyHardCapPerProject: 3, gateTtlHours: 24, absence: { until: 999, note: "出差" } }), "utf8");
    expect(loadInboxPolicy(join(dir, "q.json"))).toEqual({ dailyHardCapPerProject: 3, gateTtlHours: 24, absence: { until: 999, note: "出差" } });
  });

  it("保存原子落盘并可回读", async () => {
    const p = join(dir, "nested", "inbox-policy.json");
    await saveInboxPolicy(p, { dailyHardCapPerProject: 2, gateTtlHours: 48, absence: { until: 123 } });
    expect(JSON.parse(readFileSync(p, "utf8"))).toEqual({ dailyHardCapPerProject: 2, gateTtlHours: 48, absence: { until: 123 } });
    expect(loadInboxPolicy(p).absence?.until).toBe(123);
  });
});