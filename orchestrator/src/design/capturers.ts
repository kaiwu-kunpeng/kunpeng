// 截图适配器 —— ScreenshotCapturer 的真实现（可插拔，沿用 CliRunner 后端范式）。
// PlaywrightCapturer：进程内 headless chromium，可靠默认。
// AgentCapturer：经后端 agent 用其浏览器工具（chrome-devtools MCP / computer-use / codex），零新依赖、可扩展。
// 真渲染是浏览器/agent I/O，不做确定性断言；选择器 pickCapturer 的纯逻辑可测。
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { FakeCapturer, type ScreenshotCapturer } from "./screenshot.js";
import type { AgentRunner } from "../agent/runner.js";

/** 进程内 headless chromium 渲染 HTML → 截 PNG。需 devDep `playwright` + `npx playwright install chromium`。 */
export class PlaywrightCapturer implements ScreenshotCapturer {
  constructor(private viewport: { width: number; height: number } = { width: 1200, height: 800 }) {}
  async capture(html: string, outPath: string): Promise<void> {
    await mkdir(dirname(outPath), { recursive: true });
    // 动态 import：未装 chromium 的环境只在真截图时失败，不污染加载期（编排仍可用 Fake/Agent）。
    const { chromium } = await import("playwright");
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: this.viewport });
      await page.setContent(html, { waitUntil: "networkidle" });
      await page.screenshot({ path: outPath, fullPage: true });
    } finally {
      await browser.close().catch((error: unknown) => {
        console.warn("设计截图浏览器关闭失败", { outPath, error });
      });
    }
  }
}

/**
 * 经后端 agent（claude/codex）用其浏览器工具截图：把 HTML 落本地文件，让 agent 渲染并截到 outPath。
 * 复用登录态 CLI（CliRunner），覆盖用户说的 chrome-devtools MCP / computer-use / codex 浏览器。
 * 注意：headless `claude -p` 下交互态 MCP 可能缺失，故定位为 Playwright 的可选/回退，不作默认。
 * 该实现不持有 Playwright 浏览器资源，运行失败会原样交给调用方处理，不参与上方本地截图器的清理流程。
 * 输入文件与输出截图的路径约定保持不变，由已注入的 runner 负责真正打开页面并保存结果。
 */
export class AgentCapturer implements ScreenshotCapturer {
  constructor(private runner: AgentRunner) {}
  async capture(html: string, outPath: string): Promise<void> {
    await mkdir(dirname(outPath), { recursive: true });
    const htmlPath = outPath.replace(/\.png$/i, ".src.html");
    await writeFile(htmlPath, html);
    await this.runner.run({
      stage: "spec",
      system: "",
      input:
        `用你可用的浏览器工具（chrome-devtools MCP / computer-use / codex 浏览器之一）` +
        `打开本地文件 file://${htmlPath}，渲染后把整页截图保存为 PNG 到 ${outPath}。` +
        `只做这一件事，完成回 "done"。`,
      tools: ["browser", "screenshot"],
    });
  }
}

/** 按 kind / KUNPENG_CAPTURER 选截图器：playwright(默认) / agent / fake。agent 需注入 runner。 */
export function pickCapturer(opts: { kind?: string; runner?: AgentRunner } = {}): ScreenshotCapturer {
  const kind = (opts.kind ?? process.env.KUNPENG_CAPTURER ?? "playwright").toLowerCase();
  if (kind === "fake") return new FakeCapturer();
  if (kind === "agent" && opts.runner) return new AgentCapturer(opts.runner);
  return new PlaywrightCapturer();
}
