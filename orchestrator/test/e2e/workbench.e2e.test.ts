import { describe, expect, it } from "vitest";
import { withCockpit, withBrowserPage } from "../support/cockpit-e2e.js";

// 真浏览器 e2e:默认跳过(慢/需浏览器),accept 用 KP_E2E=1 触发。
describe.runIf(process.env.KP_E2E === "1")("workbench 真浏览器 e2e", () => {
  it("工作台渲染窗口 + / 弹命令菜单", async () => {
    await withCockpit(process.cwd(), async ({ baseUrl }) => {
      await withBrowserPage(baseUrl, "#/workbench", async (page) => {
        await page.waitForSelector(".kp-win", { timeout: 12000 });
        await page.click(".kp-win-input");
        await page.type(".kp-win-input", "/");
        await page.waitForSelector(".kp-cmdmenu .kp-cmdrow", { timeout: 5000 });
        const rows = await page.$$(".kp-cmdmenu .kp-cmdrow");
        expect(rows.length).toBeGreaterThan(0);
      });
    });
  }, 60000);
});
