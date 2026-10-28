import { describe, expect, it } from "vitest";
import { withCockpit, withBrowserPage } from "../support/cockpit-e2e.js";

describe.runIf(process.env.KP_E2E === "1")("PTY 断线自动重连 e2e", () => {
  it("掉线后自动重连、复用会话、回放滚屏", async () => {
    await withCockpit(process.cwd(), async ({ baseUrl }) => {
      await withBrowserPage(baseUrl, "#/terminal", async (page) => {
        await page.waitForSelector(".xterm-screen", { timeout: 15000 });
        await page.waitForFunction(() => (document.getElementById("kp-term-status") || {}).textContent === "已连接", undefined, { timeout: 15000 });
        const sess1 = await page.evaluate(() => (document.getElementById("kp-term-session") || {}).textContent || "");
        expect(sess1).toContain("会话");
        await page.click(".xterm-helper-textarea");
        await page.keyboard.type("echo RC_MARK_42");
        await page.keyboard.press("Enter");
        await page.waitForFunction(() => /RC_MARK_42/.test((document.querySelector(".xterm-rows") || {}).textContent || ""), undefined, { timeout: 10000 });
        // 掉线
        await page.context().setOffline(true);
        await page.waitForFunction(() => /断/.test(((document.getElementById("kp-term-status") || {}).textContent) || ""), undefined, { timeout: 12000 });
        // 恢复 → 自动重连
        await page.context().setOffline(false);
        await page.waitForFunction(() => (document.getElementById("kp-term-status") || {}).textContent === "已连接", undefined, { timeout: 25000 });
        const sess2 = await page.evaluate(() => (document.getElementById("kp-term-session") || {}).textContent || "");
        expect(sess2).toBe(sess1);
        const rows = await page.evaluate(() => (document.querySelector(".xterm-rows") || {}).textContent || "");
        expect(rows).toContain("RC_MARK_42");
      });
    });
  }, 120000);
});
