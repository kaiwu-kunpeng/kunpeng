import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderAgentsPresentPanel } from "../../src/server/ui/views/overview.js";

const source = readFileSync(
  fileURLToPath(new URL("../../src/server/ui/views/overview.ts", import.meta.url)),
  "utf8",
);

describe("面板不许有「看参数个数」的兼容分支", () => {
  it("源码里没有 arguments / legacyCallWithoutNow / nowMs 的字符串分支", () => {
    expect(source).not.toContain("legacyCallWithoutNow");
    expect(source).not.toMatch(/\barguments\.length\b/);
    expect(source).not.toContain('typeof nowMs === "string"');
  });

  it("源码里旧文案「无在场」已彻底消失", () => {
    expect(source).not.toContain("无在场");
  });

  it("行为不随参数个数变化:传 2 个与只传 1 个,空态文案一致", () => {
    const withNow = renderAgentsPresentPanel([], 1_000_000_000);
    // 故意在 JS 层少传一个参数（tsconfig 的 include 只有 src，测试不做类型检查）
    const withoutNow = (renderAgentsPresentPanel as unknown as (a: unknown[]) => string)([]);
    expect(withNow).toContain("最近 30 分钟无 agent 活动");
    expect(withoutNow).toContain("最近 30 分钟无 agent 活动");
    expect(withNow).not.toContain("无在场");
    expect(withoutNow).not.toContain("无在场");
  });

  it("非空时仍按「次登记」口径渲染,不出现「在场」", () => {
    const now = 1_000_000_000;
    const html = renderAgentsPresentPanel(
      [{ instance: "cc-a", projectId: "proj-alpha", task: "会话", ts: now - 3 * 60_000 }],
      now,
    );
    expect(html).toContain("1 次登记");
    expect(html).toContain("3 分钟前");
    expect(html).not.toContain("在场");
  });
});