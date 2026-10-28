// 候选预览编排 preview-candidates —— 把一组设计候选逐个渲成 HTML 预览并截图落盘。
// 跨模块仅 import type 引入 contract / screenshot 的类型；renderPreviewHtml 为纯函数复用。
// IO 仅限本编排：mkdir -p outDir、写 HTML、调 capturer 截图（阶段一独占文件不重建，C1）。

import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { DesignCandidate } from "./contract.js";
import type { ScreenshotCapturer } from "./screenshot.js";
import { renderPreviewHtml } from "./preview.js";

/** 单个候选的预览产物：来源 / 锚点 + HTML、PNG 落盘路径。 */
export interface CandidatePreview {
  /** 候选来源标识（透传自 candidate.source）。 */
  source: string;
  /** 候选设计锚点（透传自 candidate.contract.anchor）。 */
  anchor: string;
  /** 渲染出的 HTML 落盘路径。 */
  htmlPath: string;
  /** 截图落盘路径。 */
  pngPath: string;
}

/**
 * 编排：把每个候选渲成自包含 HTML 预览并截图，按输入顺序产出预览清单。
 *
 * - 文件名按候选下标命名 `cand-${i}.{html,png}`
 *   （DesignCandidate 无 index 字段，且 source 含冒号不宜直接做文件名）。
 * - 每个候选：renderPreviewHtml → mkdir -p outDir → 写 HTML → capturer.capture 出 PNG。
 * - 结果数组与输入 candidates 一一对应、顺序保持。
 */
export async function previewCandidates(
  candidates: DesignCandidate[],
  capturer: ScreenshotCapturer,
  outDir: string,
): Promise<CandidatePreview[]> {
  return Promise.all(
    candidates.map(async (candidate, i) => {
      const html = renderPreviewHtml(candidate.contract);
      const htmlPath = join(outDir, `cand-${i}.html`);
      const pngPath = join(outDir, `cand-${i}.png`);

      await mkdir(outDir, { recursive: true });
      await writeFile(htmlPath, html);
      await capturer.capture(html, pngPath);

      return {
        source: candidate.source,
        anchor: candidate.contract.anchor,
        htmlPath,
        pngPath,
      };
    }),
  );
}
