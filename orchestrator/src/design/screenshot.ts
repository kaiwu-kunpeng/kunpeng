import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

/** HTML → 截图的抽象边界。真实现（Playwright）留人工接入。 */
export interface ScreenshotCapturer {
  capture(html: string, outPath: string): Promise<void>;
}

/**
 * 确定性假实现：不启动浏览器，只把含 HTML 长度的占位内容写入 outPath，
 * 使编排可在无 Playwright 环境 dogfood。
 */
export class FakeCapturer implements ScreenshotCapturer {
  async capture(html: string, outPath: string): Promise<void> {
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, `fake-screenshot html.length=${html.length}\n`);
  }
}
