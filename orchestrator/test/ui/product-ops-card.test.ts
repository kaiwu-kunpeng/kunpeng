import { describe, it, expect } from "vitest";
import { renderOpsCard } from "../../src/server/ui/views/project.js";

describe("产品运营健康卡", () => {
  it("有数据 → pv/报错/top 事件", () => {
    const html = renderOpsCard({ pageviews: 37, errors: 2, topEvents: [{ name: "signup", count: 5 }] }, "demo-app");
    expect(html).toContain("ops-card");
    expect(html).toContain("37");
    expect(html).toContain("2");
    expect(html).toContain("signup");
  });

  it("无数据 → 空态带接入代码（转义后的 script 标签文本）", () => {
    const html = renderOpsCard(undefined, "demo-app");
    expect(html).toContain("尚无运营数据");
    expect(html).toContain("kp-beacon.js?slug=demo-app");
    expect(html.includes("<script src=")).toBe(false);
  });
});