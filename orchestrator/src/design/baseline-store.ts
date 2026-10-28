import { access, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ScreenshotCapturer } from "./screenshot.js";

export function baselinePath(repoRoot: string, key: string): string {
  return join(repoRoot, ".kunpeng", "design-baselines", `${key}.png`);
}

export async function baselineExists(repoRoot: string, key: string): Promise<boolean> {
  try {
    await access(baselinePath(repoRoot, key));
    return true;
  } catch {
    return false;
  }
}

/** 用注入 capturer 截 html 存基线 png（首次落基线 / 人审批准更新后）。返回基线路径。 */
export async function captureBaseline(
  repoRoot: string,
  key: string,
  html: string,
  capturer: ScreenshotCapturer,
): Promise<string> {
  const path = baselinePath(repoRoot, key);
  await mkdir(dirname(path), { recursive: true });
  await capturer.capture(html, path);
  return path;
}
