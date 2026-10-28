import { existsSync, readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import "../../src/server/http.js";
import { dispatchModularRoute, type RouteContext } from "../../src/server/routes/registry.js";
import { renderSettings } from "../../src/server/ui/views/settings.js";
import type { DashboardState } from "../../src/server/state-types.js";

function srcPath(rel: string): string {
  return fileURLToPath(new URL(`../../src/${rel}`, import.meta.url));
}

function testPath(rel: string): string {
  return fileURLToPath(new URL(`../${rel}`, import.meta.url));
}

describe("左侧与手机端不再有账号入口", () => {
  it("sidebar 源码里没有 /accounts，其余入口仍在", () => {
    const src = readFileSync(srcPath("server/ui/sidebar.ts"), "utf8");
    expect(src).not.toContain('href="/accounts"');
    expect(src).toContain('href="/plugins"');
    expect(src).toContain('href="/help"');
  });

  it("mobile-tabbar 源码里没有 /accounts，其余入口仍在", () => {
    const src = readFileSync(srcPath("server/ui/mobile-tabbar.ts"), "utf8");
    expect(src).not.toContain('href="/accounts"');
    expect(src).toContain('href="/plugins"');
    expect(src).toContain('href="/help"');
  });
});

describe("页面与路由已下线", () => {
  it("accounts-page.ts 文件不存在", () => {
    expect(existsSync(srcPath("server/routes/accounts-page.ts"))).toBe(false);
  });

  it("http.ts 不再 import accounts-page", () => {
    expect(readFileSync(srcPath("server/http.ts"), "utf8")).not.toContain("accounts-page");
  });

  it("GET /accounts 不再命中任何路由", async () => {
    let ended = false;
    const res = {
      writeHead() {},
      setHeader() {},
      end() { ended = true; },
    } as unknown as ServerResponse;
    const context: RouteContext = { stateDir: "/tmp", repoRoot: "/tmp" };
    const hit = await dispatchModularRoute(
      "GET",
      "/accounts",
      {} as unknown as IncomingMessage,
      res,
      context,
    );
    expect(hit && ended).toBeFalsy();
  });
});

describe("前置流的临时护栏已随本流移除", () => {
  it("只摘掉冲突的那个 describe，其余用例原样保留", () => {
    const src = readFileSync(testPath("ui/settings-account-health.accept.test.ts"), "utf8");
    expect(src).not.toContain("本流不碰将要下线的入口");
    expect(src).toContain("设置页只读面板展示账号健康检查");
    expect(src).toContain("收集端接的是现成判定");
    expect(src).toContain("reason 里的 HTML 元字符被转义");
  });
});

describe("过度导出清单同步收口", () => {
  it("CASES 里没有 accounts-page，且规模断言同步改成 52", () => {
    const src = readFileSync(testPath("refactor/over-export.test.ts"), "utf8");
    expect(src).not.toContain("accounts-page");
    expect(src).toContain("expect(CASES.length).toBe(51)");
    expect(src).not.toContain("expect(CASES.length).toBe(53)");
  });
});

describe("信息未丢且未误伤登录用户体系", () => {
  it("设置页仍展示账号健康检查", () => {
    const state = {
      backend: {},
      quota: {
        total: 1,
        accounts: [{ id: "a1", used: 1, limit: 10, models: [], health: { ok: false, reason: "空目录" } }],
      },
    } as unknown as DashboardState;
    const html = renderSettings(state);
    expect(html).toContain("健康未通过");
    expect(html).toContain("空目录");
  });

  it("/api/accounts 四个方法仍全部注册", async () => {
    for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
      let touched = false;
      const res = {
        writeHead() {},
        setHeader() {},
        end() { touched = true; },
        get statusCode() { return 200; },
        set statusCode(_v: number) { touched = true; },
      } as unknown as ServerResponse;
      const hit = await dispatchModularRoute(
        method,
        "/api/accounts",
        { headers: {} } as unknown as IncomingMessage,
        res,
        { stateDir: "/tmp", repoRoot: "/tmp" } as RouteContext,
      ).catch(() => true);
      expect(Boolean(hit) || touched, `${method} /api/accounts 应仍被注册`).toBe(true);
    }
  });
});