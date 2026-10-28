// 验收锚:dist 落后主干时必须在「待我处理」最前面亮出来;读不到信息时宁可不报。
import { describe, it, expect } from "vitest";
import { assessDistFreshness, distStaleTitle } from "../../src/runtime/dist-freshness.js";
import { attentionItemsFromSnapshots } from "../../src/server/routes/attention.js";
import type { Escalation } from "../../src/switchboard/escalation.js";

const MIN = 60_000;
const HOUR = 60 * MIN;

describe("assessDistFreshness", () => {
  it("提交晚于构建超过容差 → stale", () => {
    const f = assessDistFreshness({ builtAt: 1_000_000, committedAt: 1_000_000 + 35 * MIN });
    expect(f.stale).toBe(true);
    expect(f.behindMs).toBe(35 * MIN);
  });

  it("dist 比主干新 → 不 stale,behindMs 为 0", () => {
    const f = assessDistFreshness({ builtAt: 2_000_000, committedAt: 1_000_000 });
    expect(f.stale).toBe(false);
    expect(f.behindMs).toBe(0);
  });

  it("落后在容差内不算 stale(缺省 1 分钟)", () => {
    expect(assessDistFreshness({ builtAt: 0, committedAt: 30_000 }).stale).toBe(false);
    expect(assessDistFreshness({ builtAt: 0, committedAt: 90_000 }).stale).toBe(true);
  });

  it("容差可覆盖", () => {
    expect(assessDistFreshness({ builtAt: 0, committedAt: 5 * MIN, toleranceMs: 10 * MIN }).stale).toBe(false);
  });

  it("非有限输入一律不报(宁漏勿误报)", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(assessDistFreshness({ builtAt: bad, committedAt: 1_000 }).stale).toBe(false);
      expect(assessDistFreshness({ builtAt: 1_000, committedAt: bad }).stale).toBe(false);
    }
  });
});

describe("distStaleTitle", () => {
  it("分钟级与小时级措辞不同,且都提示要重启", () => {
    const mins = distStaleTitle(assessDistFreshness({ builtAt: 0, committedAt: 35 * MIN }));
    const hours = distStaleTitle(assessDistFreshness({ builtAt: 0, committedAt: 3 * HOUR }));
    expect(mins).not.toBe(hours);
    expect(mins).toContain("重启");
    expect(hours).toContain("重启");
    expect(mins.trim().length).toBeGreaterThan(0);
  });
});

describe("接入 attention", () => {
  const esc: Escalation = {
    reason: "stale-unread",
    message: { id: "m1", from: "patrol", to: "all", body: "紧急", ts: 1, urgent: true, read: false } as Escalation["message"],
  };

  it("不传时行为不变(既有断言不许破)", () => {
    expect(attentionItemsFromSnapshots([])).toEqual([]);
  });

  it("stale 时产出恰好一项,且排在最前(升级消息之前)", () => {
    const f = assessDistFreshness({ builtAt: 0, committedAt: 35 * MIN });
    const items = attentionItemsFromSnapshots([], undefined, [esc], f);
    expect(items[0].kind).toBe("stale-dist");
    expect(items.filter((i) => i.kind === "stale-dist")).toHaveLength(1);
    expect(items.some((i) => i.kind === "escalation")).toBe(true);
  });

  it("不 stale 时不产出该项", () => {
    const fresh = assessDistFreshness({ builtAt: 2_000_000, committedAt: 1_000_000 });
    const items = attentionItemsFromSnapshots([], undefined, [esc], fresh);
    expect(items.some((i) => i.kind === "stale-dist")).toBe(false);
  });

  it("只有 stale 项时也能单独出现", () => {
    const f = assessDistFreshness({ builtAt: 0, committedAt: 2 * HOUR });
    const items = attentionItemsFromSnapshots([], undefined, undefined, f);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("stale-dist");
    expect(items[0].href).toBe("#/overview");
  });
});