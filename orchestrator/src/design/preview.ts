// 设计预览渲染器 —— 把一份已解析的设计契约渲成一页自包含 HTML 预览。
// 纯函数、确定性：不读 IO、不调浏览器、不调 LLM、无顶层副作用（C8）。
// 跨模块仅 `import type` 引入 contract（C1：contract.ts 由阶段一独占，不重建）。
import type { DesignContract } from "./contract.js";

/** 极简 HTML 转义，避免 token 值 / 名称里的尖括号引号破坏页面结构。 */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * 把契约的三组 token 展开为 `:root` 下的 CSS 变量声明。
 * 每个键渲成 `--<key>:<value>;`（冒号后无空格，逐字可断言）。
 */
function tokenVars(c: DesignContract): string {
  const { colors, spacing, typography } = c.tokens;
  return [colors, spacing, typography]
    .flatMap((group) => Object.entries(group))
    .map(([k, v]) => `--${k}:${v};`)
    .join("");
}

/**
 * 纯函数：把设计契约渲成单个自包含 HTML 字符串。
 *
 * - 内联 `<style>`，无外部依赖；
 * - `c.tokens` 三组展开进 `:root{ ... }` 为 CSS 变量；
 * - `c.anchor` 作为标题出现；
 * - `c.components` 每个组件名各渲一个样例块，用 token 变量做背景/前景。
 */
export function renderPreviewHtml(c: DesignContract): string {
  const vars = tokenVars(c);

  const samples = c.components
    .map(
      (name) =>
        `<div class="sample" style="background:var(--background);color:var(--foreground);` +
        `border:1px solid var(--border,var(--muted,#e5e7eb));padding:var(--md,16px)">` +
        `<span class="sample-name">${esc(name)}</span>` +
        `<button style="background:var(--primary);color:var(--primary-foreground,var(--background))">` +
        `${esc(name)}</button>` +
        `</div>`,
    )
    .join("");

  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<title>${esc(c.anchor)}</title>` +
    `<style>:root{${vars}}` +
    `body{background:var(--background);color:var(--foreground);` +
    `font-family:var(--sans,system-ui,sans-serif);margin:0;padding:var(--lg,24px)}` +
    `.sample{display:flex;align-items:center;gap:var(--sm,8px);margin:var(--sm,8px) 0;border-radius:8px}` +
    `.sample-name{font-weight:600}` +
    `</style></head><body>` +
    `<h1>${esc(c.anchor)}</h1>` +
    `<p class="source">${esc(c.source)}</p>` +
    `<section class="components">${samples}</section>` +
    `</body></html>`
  );
}
