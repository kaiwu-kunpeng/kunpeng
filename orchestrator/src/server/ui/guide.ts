import { escHtml as escapeHtml } from "../../util/esc-html.js";
export interface GuideStep {
  label: string;
  detail?: string;
  cmd?: string;
}

export function renderUsageGuide(opts: { id: string; title: string; intro: string; steps: GuideStep[] }): string {
  const rows = opts.steps.map((step, index) => {
    const detail = step.detail ? `<span class="hint">${escapeHtml(step.detail)}</span>` : "";
    const cmd = step.cmd ? `<code>${escapeHtml(step.cmd)}</code>` : "";
    return `<div class="run"><span class="tag">${escapeHtml(index + 1)}</span><span class="name">${escapeHtml(step.label)}</span>${detail}${cmd}</div>`;
  }).join("");

  return `<details class="runs loop-panel" data-guide="${escapeHtml(opts.id)}" open>
    <summary class="section-h"><span class="name">${escapeHtml(opts.title)}</span><span class="hint">怎么用</span></summary>
    <div class="run"><span class="name">${escapeHtml(opts.intro)}</span></div>
    ${rows}
  </details>`;
}
