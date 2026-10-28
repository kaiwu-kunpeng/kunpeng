import { describe, it, expect } from "vitest";
import { isCsrfSafe } from "../../src/server/workspace-endpoints.js";

const HOST = "cockpit.example.io";

describe("isCsrfSafe — 堵 GET /exec CSRF", () => {
  it("同源 EventSource(Sec-Fetch-Site: same-origin) 放行", () => {
    expect(isCsrfSafe({ "sec-fetch-site": "same-origin", "sec-fetch-mode": "cors", host: HOST }, HOST)).toBe(true);
  });

  it("跨站请求(cross-site)拦截", () => {
    expect(isCsrfSafe({ "sec-fetch-site": "cross-site", host: HOST }, HOST)).toBe(false);
  });

  it("顶层导航(Sec-Fetch-Mode: navigate)拦截 —— 正是 location= 型 CSRF", () => {
    expect(isCsrfSafe({ "sec-fetch-mode": "navigate", "sec-fetch-site": "cross-site", host: HOST }, HOST)).toBe(false);
    // 即便 site 头缺失,navigate 也拦
    expect(isCsrfSafe({ "sec-fetch-mode": "navigate", host: HOST }, HOST)).toBe(false);
  });

  it("same-site 拒（兄弟子域同站也不放行）、none 放行", () => {
    expect(isCsrfSafe({ "sec-fetch-site": "same-site", host: HOST }, HOST)).toBe(false);
    expect(isCsrfSafe({ "sec-fetch-site": "none", "sec-fetch-mode": "cors", host: HOST }, HOST)).toBe(true);
  });

  it("老浏览器无 Sec-Fetch-*:Origin 跨主机拦、同主机放行", () => {
    expect(isCsrfSafe({ origin: "https://evil.test", host: HOST }, HOST)).toBe(false);
    expect(isCsrfSafe({ origin: "https://" + HOST, host: HOST }, HOST)).toBe(true);
  });

  it("老浏览器无 Sec-Fetch-*、无 Origin:用 Referer host 比对", () => {
    expect(isCsrfSafe({ referer: "https://evil.test/attack", host: HOST }, HOST)).toBe(false);
    expect(isCsrfSafe({ referer: "https://" + HOST + "/#/workbench", host: HOST }, HOST)).toBe(true);
  });

  it("三者皆无(极老/非浏览器):放行(不误伤)", () => {
    expect(isCsrfSafe({ host: HOST }, HOST)).toBe(true);
  });

  it("数组型 header 值取首个", () => {
    expect(isCsrfSafe({ "sec-fetch-site": ["cross-site"], host: HOST }, HOST)).toBe(false);
  });
});