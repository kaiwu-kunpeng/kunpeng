// 验收锚:紧急消息必须出现在「待我处理」里 —— 已有告警缺的是出口,不是机制。
import { describe, it, expect } from "vitest";
import { attentionItemsFromSnapshots } from "../../src/server/routes/attention.js";
import type { Escalation } from "../../src/switchboard/escalation.js";

function esc(body: string, from = "patrol", reason: Escalation["reason"] = "stale-unread"): Escalation {
  return {
    reason,
    message: {
      id: `m-${from}-${body.length}`,
      from,
      to: "all",
      body,
      ts: 1,
      urgent: true,
      read: false,
    } as Escalation["message"],
  };
}

describe("升级消息接入 attention", () => {
  it("不传 escalations 时行为不变(既有断言不许破)", () => {
    expect(attentionItemsFromSnapshots([])).toEqual([]);
  });

  it("传入的每条升级都产出一个 escalation 项", () => {
    const items = attentionItemsFromSnapshots([], undefined, [
      esc("采集已跳过(login EXPIRED)"),
      esc("供应商催办全部 bounce", "tl"),
    ]);
    const escItems = items.filter((i) => i.kind === "escalation");
    expect(escItems).toHaveLength(2);
    expect(escItems[0].href).toBe("#/switchboard");
  });

  it("标题取正文首行并截断到 60 字符内", () => {
    const long = "A".repeat(200);
    const items = attentionItemsFromSnapshots([], undefined, [esc(`${long}\n第二行不该出现`)]);
    const t = items[0].title;
    expect(t.length).toBeLessThanOrEqual(61);
    expect(t.includes("第二行不该出现")).toBe(false);
  });

  it("正文为空时有回退文案,不产出空标题", () => {
    const items = attentionItemsFromSnapshots([], undefined, [esc("   ", "tl-capture-health")]);
    expect(items[0].title.trim().length).toBeGreaterThan(0);
    expect(items[0].title).toContain("tl-capture-health");
  });

  it("升级项排在其余 attention 项前面", () => {
    const items = attentionItemsFromSnapshots([], undefined, [esc("紧急")]);
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].kind).toBe("escalation");
  });

  it("空升级列表等价于不传", () => {
    expect(attentionItemsFromSnapshots([], undefined, [])).toEqual(attentionItemsFromSnapshots([]));
  });

  it("两种 reason 都会产出条目", () => {
    const items = attentionItemsFromSnapshots([], undefined, [
      esc("离线的", "a", "recipient-offline"),
      esc("超时的", "b", "stale-unread"),
    ]);
    expect(items.filter((i) => i.kind === "escalation")).toHaveLength(2);
  });
});