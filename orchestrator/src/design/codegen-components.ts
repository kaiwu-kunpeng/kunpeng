// 组件样例 codegen-components —— 把组件名确定性渲染为自包含、a11y-clean 的 HTML 片段。
// 本文件无副作用：纯函数、不读 IO、不调 LLM（C8 确定性优先）。

function esc(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderComponentSample(name: string): string {
  switch (name.toLowerCase()) {
    case "button":
      return `<button type="button" style="background:var(--color-primary);color:var(--color-background);padding:var(--space-sm) var(--space-md);font-family:var(--font-sans);border:0;border-radius:6px">Button</button>`;
    case "input":
      return `<label style="display:grid;gap:var(--space-xs);font-family:var(--font-sans);color:var(--color-foreground)">Input Email<input type="email" name="email" placeholder="you@example.com" style="background:var(--color-background);color:var(--color-foreground);padding:var(--space-sm);font-family:var(--font-sans);border:1px solid var(--color-border,#e5e7eb);border-radius:6px" /></label>`;
    case "card":
      return `<article style="background:var(--color-background);color:var(--color-foreground);padding:var(--space-md);font-family:var(--font-sans);border:1px solid var(--color-border,#e5e7eb);border-radius:8px"><h3 style="font-family:var(--font-sans);margin-top:0">Card</h3><p>卡片正文示例。</p><button type="button" style="background:var(--color-primary);color:var(--color-background);padding:var(--space-sm) var(--space-md);font-family:var(--font-sans);border:0;border-radius:6px">操作</button></article>`;
    case "dialog":
      return `<section role="dialog" aria-label="示例对话框" style="background:var(--color-background);color:var(--color-foreground);padding:var(--space-md);font-family:var(--font-sans);border:1px solid var(--color-border,#e5e7eb);border-radius:8px"><h3 style="font-family:var(--font-sans);margin-top:0">Dialog</h3><p>对话框正文。</p><button type="button" style="background:var(--color-primary);color:var(--color-background);padding:var(--space-sm) var(--space-md);font-family:var(--font-sans);border:0;border-radius:6px">确认</button></section>`;
    case "tabs":
      return `<div role="tablist" aria-label="示例标签页" style="display:flex;gap:var(--space-xs);font-family:var(--font-sans);background:var(--color-muted,#f4f4f5);padding:var(--space-xs);border-radius:8px"><button type="button" role="tab" aria-selected="true" style="background:var(--color-background);color:var(--color-foreground);padding:var(--space-sm) var(--space-md);font-family:var(--font-sans);border:1px solid var(--color-border,#e5e7eb);border-radius:6px">Tab 1</button><button type="button" role="tab" aria-selected="false" style="background:transparent;color:var(--color-foreground);padding:var(--space-sm) var(--space-md);font-family:var(--font-sans);border:1px solid transparent;border-radius:6px">Tab 2</button></div>`;
    case "badge":
      return `<span style="display:inline-flex;align-items:center;background:var(--color-primary);color:var(--color-background);padding:var(--space-xs) var(--space-sm);font-family:var(--font-sans);border-radius:999px">Badge</span>`;
    case "alert":
      return `<div role="alert" style="background:var(--color-accent,#fef3c7);color:var(--color-foreground);padding:var(--space-md);font-family:var(--font-sans);border:1px solid var(--color-border,#e5e7eb);border-radius:8px">Alert 提示信息示例。</div>`;
    case "checkbox":
      return `<label style="display:inline-flex;align-items:center;gap:var(--space-xs);font-family:var(--font-sans);color:var(--color-foreground)"><input type="checkbox" name="agree" /> Checkbox 同意条款</label>`;
    default:
      return `<section style="background:var(--color-background);padding:var(--space-md);font-family:var(--font-sans)">${esc(name)}</section>`;
  }
}

export function renderComponentSamples(names: string[]): string {
  return names.map((name) => renderComponentSample(name)).join("\n");
}
