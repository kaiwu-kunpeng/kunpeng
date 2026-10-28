import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderSettings } from "../../src/server/ui/views/settings.js";
import type { DashboardState } from "../../src/server/state-types.js";

type QuotaAccount = NonNullable<DashboardState["quota"]>["accounts"][number];

function stateWith(accounts: QuotaAccount[]): DashboardState {
  return { quota: { accounts, total: 7 }, backend: {} } as unknown as DashboardState;
}

function account(id: string, health?: { ok: boolean; reason?: string }): QuotaAccount {
  return { id, used: 1, limit: 10, models: [], ...(health ? { health } : {}) } as QuotaAccount;
}

describe("设置页只读面板展示账号健康检查", () => {
  it("health.ok=true → 出现「健康通过」", () => {
    const html = renderSettings(stateWith([account("a1", { ok: true })]));
    expect(html).toContain("健康通过");
    expect(html).not.toContain("健康未通过");
  });

  it("health.ok=false → 出现「健康未通过」且带上 reason", () => {
    const html = renderSettings(
      stateWith([account("a1", { ok: false, reason: "CLAUDE_CONFIG_DIR 指向空目录" })]),
    );
    expect(html).toContain("健康未通过");
    expect(html).toContain("CLAUDE_CONFIG_DIR 指向空目录");
  });

  it("无 health 字段 → 不凭空显示健康文案", () => {
    const html = renderSettings(stateWith([account("a1")]));
    expect(html).not.toContain("健康通过");
    expect(html).not.toContain("健康未通过");
  });

  it("reason 里的 HTML 元字符被转义", () => {
    const html = renderSettings(
      stateWith([account("a1", { ok: false, reason: "<img src=x onerror=alert(1)>" })]),
    );
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });

  it("quota 整体缺失时不抛错，保留既有兜底", () => {
    const html = renderSettings({ backend: {} } as unknown as DashboardState);
    expect(html).toContain("暂无数据");
  });

  it("既有面板内容不回归", () => {
    const html = renderSettings(stateWith([account("a1", { ok: true })]));
    expect(html).toContain("启用后端");
    expect(html).toContain("配额合计");
  });
});

describe("收集端接的是现成判定，不是重新实现", () => {
  it("dashboard collector 引用 checkAccountEnvHealth", () => {
    const src = readFileSync(
      new URL("../../src/server/state-collect/dashboard.ts", import.meta.url),
      "utf8",
    );
    expect(src).toContain("checkAccountEnvHealth");
  });

  it("state-types 的 quota 账号元素带 health 字段", () => {
    const src = readFileSync(
      new URL("../../src/server/state-types.ts", import.meta.url),
      "utf8",
    );
    expect(src).toMatch(/health\?:\s*\{\s*ok:\s*boolean/);
  });
});
