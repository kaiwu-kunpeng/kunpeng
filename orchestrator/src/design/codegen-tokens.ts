// token 渲染 codegen-tokens —— 把已解析的 DesignContract 渲染为可落盘 CSS。
// 单一 token 源：同一份 c.tokens 同时驱动原生 CSS 变量与 Tailwind v4 CSS-first 主题。
// 本文件无副作用：不读 IO、不调 LLM、无随机/时间依赖（C8 确定性优先），同输入恒等输出。
import type { DesignContract } from "./contract.js";

/** 把一组 token 按给定前缀渲成 `--<prefix>-<key>: <value>;` 行（每行带两格缩进）。 */
function renderVars(prefix: string, group: Record<string, string>): string[] {
  return Object.entries(group).map(([key, value]) => `  --${prefix}-${key}: ${value};`);
}

/** 把三组 token 按前缀（colors/spacing/typography）渲成变量行，避免跨组键名碰撞。 */
function renderGroups(c: DesignContract, spacingPrefix: string): string[] {
  return [
    ...renderVars("color", c.tokens.colors),
    ...renderVars(spacingPrefix, c.tokens.spacing),
    ...renderVars("font", c.tokens.typography),
  ];
}

/**
 * 纯函数：把契约渲成原生 CSS 变量。
 *
 * 首行 `/* ${c.anchor} *\/` 注释 + 一个 `:root { ... }` 块，三组 token 各按前缀渲成变量行：
 *  - colors → `--color-<key>`，spacing → `--space-<key>`，typography → `--font-<key>`。
 */
export function renderTokensCss(c: DesignContract): string {
  const lines = renderGroups(c, "space");
  return `/* ${c.anchor} */\n:root {\n${lines.join("\n")}\n}\n`;
}

/**
 * 纯函数：把契约渲成 Tailwind v4 `@theme` 块（CSS-first）。
 *
 * 一个 `@theme { ... }` 块，消费同一份 `c.tokens`：
 *  - colors → `--color-<key>`，spacing → `--spacing-<key>`，typography → `--font-<key>`。
 */
export function renderTailwindTheme(c: DesignContract): string {
  const lines = renderGroups(c, "spacing");
  return `@theme {\n${lines.join("\n")}\n}\n`;
}
