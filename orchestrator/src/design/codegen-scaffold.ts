// 脚手架渲染 codegen-scaffold —— 把 DesignContract 渲成 shadcn 安装指引 + 自包含 starter 页。
// 本文件无副作用：纯函数、不读 IO、不调 LLM（C8 确定性优先）。

import { renderComponentSamples } from "./codegen-components.js";
import type { DesignContract } from "./contract.js";

/**
 * 纯函数：把契约渲成 shadcn 安装指引文本（三行）。
 *
 * 1. `# ${anchor}` —— 设计锚点标题
 * 2. `npx shadcn@latest add <小写组件 id 空格分隔>` —— shadcn CLI 用小写 id 拉真组件源
 * 3. token 出处提示
 */
export function renderShadcnInstall(c: DesignContract): string {
  const ids = c.components.map((name) => name.toLowerCase()).join(" ");
  return [`# ${c.anchor}`, `npx shadcn@latest add ${ids}`, `tokens 见 globals.css`].join("\n");
}

/**
 * 纯函数：把契约渲成一份自包含 HTML starter 页（可被 P7b 截图）。
 *
 * - `<style>:root{...}` 内联三组 token 变量：colors→`--color-`、spacing→`--space-`、typography→`--font-`。
 * - `<h1>` 显示 `c.anchor`。
 * - 每个 `c.components` 渲一个用上 token 变量的样例块。
 * 不引用 layoutIntent（契约里不存在该字段）。
 */
export function renderStarterPage(c: DesignContract): string {
  const vars = [
    ...Object.entries(c.tokens.colors).map(([k, v]) => `  --color-${k}: ${v};`),
    ...Object.entries(c.tokens.spacing).map(([k, v]) => `  --space-${k}: ${v};`),
    ...Object.entries(c.tokens.typography).map(([k, v]) => `  --font-${k}: ${v};`),
  ].join("\n");

  const blocks = renderComponentSamples(c.components);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${c.anchor}</title>
<style>
:root {
${vars}
}
body { background: var(--color-background); font-family: var(--font-sans); }
</style>
</head>
<body>
  <h1>${c.anchor}</h1>
  <main>
${blocks}
  </main>
</body>
</html>`;
}
