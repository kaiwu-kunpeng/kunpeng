import { escHtml } from "../../util/esc-html.js";

export interface EmptyStateSpec {
  title: string;
  hint?: string;
  actions?: Array<{ label: string; action?: string; href?: string }>;
}

function renderAction(item: NonNullable<EmptyStateSpec["actions"]>[number]): string {
  const label = escHtml(item.label);
  if (item.href !== undefined) return `<a class="b" href="${escHtml(item.href)}">${label}</a>`;
  return `<button class="b" data-action="${escHtml(item.action ?? "")}">${label}</button>`;
}

export function renderEmptyState(spec: EmptyStateSpec): string {
  const hint = spec.hint ? `<span class="hint">${escHtml(spec.hint)}</span>` : "";
  const actions = spec.actions?.map(renderAction).join("") ?? "";
  return `<div class="run empty"><span class="name">${escHtml(spec.title)}</span>${hint}${actions}</div>`;
}
