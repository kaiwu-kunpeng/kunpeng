import { describe, expect, it } from "vitest";
import { MANIFEST, SERVICE_WORKER, iconPng } from "../../src/server/pwa.js";
import { withCockpit } from "../support/cockpit-e2e.js";

describe("pwa pure", () => {
  it("manifest 字段", () => {
    expect(MANIFEST.display).toBe("standalone");
    expect(MANIFEST.start_url).toContain("#/");
    expect(MANIFEST.icons.length).toBeGreaterThanOrEqual(2);
  });
  it("iconPng 返回 PNG", () => {
    const b = iconPng(512);
    expect(b.length).toBeGreaterThan(100);
    expect([b[0], b[1], b[2], b[3]]).toEqual([137, 80, 78, 71]);
  });
  it("sw 非空", () => { expect(SERVICE_WORKER).toContain("addEventListener"); });
});

describe("pwa endpoints (真 serve)", () => {
  it("四端点 + 根 HTML manifest 链接", async () => {
    await withCockpit(process.cwd(), async ({ baseUrl }) => {
      const mf = await fetch(baseUrl + "/manifest.webmanifest");
      expect(mf.headers.get("content-type") || "").toContain("manifest");
      expect((await mf.json()).name).toContain("鲲鹏");
      const sw = await fetch(baseUrl + "/sw.js");
      expect((await sw.text())).toContain("addEventListener");
      const icon = await fetch(baseUrl + "/icon-512.png");
      expect(icon.headers.get("content-type")).toContain("image/png");
      const home = await (await fetch(baseUrl + "/")).text();
      expect(home).toContain('rel="manifest"');
    });
  }, 30000);
});
