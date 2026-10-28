// @vitest-environment happy-dom
import { beforeEach, describe, expect, test, vi } from "vitest";
import { clientScript } from "../../src/server/ui/client.js";
import { renderSettings } from "../../src/server/ui/views/settings.js";

type FetchCall = { url: string; method: string; body?: string };
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("设置页「发送测试」按钮（作者锁定，真 DOM 点击）", () => {
  let calls: FetchCall[];

  beforeEach(() => {
    calls = [];
    document.documentElement.innerHTML = "<head></head><body><div id=\"view\"></div></body>";
    window.location.hash = "#/review-inbox";
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: String(init?.method ?? "GET"), body: typeof init?.body === "string" ? init.body : undefined });
      if (url === "/api/state") return { ok: true, json: async () => ({ projects: [{ id: "current", name: "current" }] }) };
      if (url.startsWith("/api/view")) return { ok: true, text: async () => "" };
      if (url === "/api/settings/notify/test") {
        return { ok: true, json: async () => ({ ok: false, sent: ["wxpusher"], failed: ["serverchan"] }) };
      }
      return { ok: true, json: async () => ({ ok: true }) };
    }));
  });

  test("设置页渲染出测试按钮与结果区", () => {
    const html = renderSettings({} as never);
    expect(html).toContain('data-action="test-notify"');
    expect(html).toContain("data-nf-result");
  });

  test("点击 → POST /api/settings/notify/test，结果区显示成功与失败的通道", async () => {
    new Function(clientScript)();
    await tick();
    await tick();
    document.getElementById("view")!.innerHTML = renderSettings({} as never);
    document.querySelector("[data-action='test-notify']")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    for (let i = 0; i < 8; i += 1) await tick();
    const posts = calls.filter((c) => c.url === "/api/settings/notify/test");
    expect(posts.length).toBe(1);
    expect(posts[0]!.method.toUpperCase()).toBe("POST");
    const result = document.querySelector("[data-nf-result]");
    expect(result).not.toBeNull();
    const text = result!.textContent ?? "";
    expect(text).toContain("wxpusher");
    expect(text).toContain("serverchan");
    expect(text).toContain("失败");
  });
});