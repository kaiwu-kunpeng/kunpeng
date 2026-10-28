import { describe, expect, it } from "vitest";
import { withCockpit } from "../support/cockpit-e2e.js";

describe("PWA 静态路由绕鉴权", () => {
  it("鉴权开启时:api 被拦,manifest/sw/icon 仍 200", async () => {
    await withCockpit(process.cwd(), async ({ baseUrl }) => {
      const api = await fetch(baseUrl + "/api/state", { redirect: "manual" });
      expect([301, 302, 401, 403]).toContain(api.status); // 鉴权确实在拦
      const mf = await fetch(baseUrl + "/manifest.webmanifest", { redirect: "manual" });
      expect(mf.status).toBe(200);
      expect((await mf.json()).name).toContain("鲲鹏");
      const sw = await fetch(baseUrl + "/sw.js", { redirect: "manual" });
      expect(sw.status).toBe(200);
      expect(await sw.text()).toContain("addEventListener");
      const icon = await fetch(baseUrl + "/icon-512.png", { redirect: "manual" });
      expect(icon.status).toBe(200);
      expect(icon.headers.get("content-type") || "").toContain("image/png");
    }, { auth: { username: "admin", password: "pw12345678" } });
  }, 30000);
});
