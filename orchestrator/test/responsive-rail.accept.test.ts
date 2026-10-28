import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const themeSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "src", "server", "ui", "theme.ts"),
  "utf8",
);

describe("自适应修复(作者验收·静态)", () => {
  it("rail 可滚动", () => {
    const railRule = themeSrc.slice(themeSrc.indexOf(".rail{"), themeSrc.indexOf(".rail{") + 400);
    expect(railRule).toContain("overflow-y:auto");
    expect(railRule).toContain("overscroll-behavior:contain");
  });
  it("内容防溢出兜底", () => {
    expect(themeSrc).toContain(".body table");
    expect(themeSrc.includes("overflow-x:auto")).toBe(true);
    expect(themeSrc).toContain(".card{min-width:0}");
  });
  it("矮屏与中宽断点", () => {
    expect(themeSrc).toContain("max-height: 700px");
    expect(themeSrc).toContain("max-width:1100px");
  });
});

const isE2E = process.env.KP_E2E === "1";
(isE2E ? describe : describe.skip)("自适应修复(真浏览器)", () => {
  it("矮视口下左栏能滚到底部入口", async () => {
    const { withCockpit, withBrowserPage } = await import("./support/cockpit-e2e.js");
    const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
    await withCockpit(repoRoot, async (h) => {
      await withBrowserPage(h.baseUrl, "/#/overview", async (page) => {
        await page.setViewportSize({ width: 1000, height: 480 });
        const r = await page.evaluate(() => {
          const rail = document.querySelector(".rail") as HTMLElement | null;
          if (!rail) return { ok: false, why: "no rail" };
          const style = getComputedStyle(rail);
          rail.scrollTop = 99999;
          return {
            ok: style.overflowY === "auto" || style.overflowY === "scroll",
            scrollable: rail.scrollHeight > rail.clientHeight ? rail.scrollTop > 0 : true,
          };
        });
        expect(r.ok).toBe(true);
        expect((r as { scrollable?: boolean }).scrollable).toBe(true);
      });
    });
  }, 60_000);

  it("900px 宽度下页面无横向溢出", async () => {
    const { withCockpit, withBrowserPage } = await import("./support/cockpit-e2e.js");
    const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
    await withCockpit(repoRoot, async (h) => {
      await withBrowserPage(h.baseUrl, "/#/overview", async (page) => {
        await page.setViewportSize({ width: 900, height: 700 });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(2);
      });
    });
  }, 60_000);
});