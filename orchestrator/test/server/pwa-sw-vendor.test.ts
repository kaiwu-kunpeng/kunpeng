import { describe, it, expect } from "vitest";
import { SERVICE_WORKER } from "../../src/server/pwa.js";

describe("service worker vendor 缓存策略", () => {
  it("有版本化 vendor 缓存名并清旧版", () => {
    expect(SERVICE_WORKER).toContain("kp-vendor-v1");
    expect(SERVICE_WORKER).toContain("caches.delete");
  });
  it("只圈 /vendor/ 走缓存,非 GET 与跨域直接放行", () => {
    expect(SERVICE_WORKER).toContain('"/vendor/"');
    expect(SERVICE_WORKER).toContain("respondWith");
    expect(SERVICE_WORKER).toContain('"GET"');
    expect(SERVICE_WORKER).toContain("self.location.origin");
  });
  it("stale-while-revalidate:cache.match + 后台 fetch + cache.put", () => {
    expect(SERVICE_WORKER).toContain("cache.match");
    expect(SERVICE_WORKER).toContain("cache.put");
  });
  it("模板串安全:SW 体内无反引号无 ${", () => {
    expect(SERVICE_WORKER.includes("`")).toBe(false);
    expect(SERVICE_WORKER.includes("${")).toBe(false);
  });
});