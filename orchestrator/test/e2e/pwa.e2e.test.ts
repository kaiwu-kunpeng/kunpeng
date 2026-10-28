import { describe, expect, it } from "vitest";
import { withCockpit, withBrowserPage } from "../support/cockpit-e2e.js";

describe.runIf(process.env.KP_E2E === "1")("pwa 真浏览器 e2e", () => {
  it("service worker 在 localhost 注册成功", async () => {
    await withCockpit(process.cwd(), async ({ baseUrl }) => {
      await withBrowserPage(baseUrl, "", async (page) => {
        const reg = await page.evaluate(async () => {
          if (!("serviceWorker" in navigator)) return false;
          const r = await navigator.serviceWorker.ready.catch(() => null);
          return !!(r && r.active) || !!(await navigator.serviceWorker.getRegistration());
        });
        expect(reg).toBe(true);
      });
    });
  }, 60000);
});
