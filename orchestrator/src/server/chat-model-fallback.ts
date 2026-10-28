import { escHtml } from "./chat-sse.js";

export function chatFallbackModel(model: string): string | undefined {
  if (model.startsWith("claude-fable")) return "claude-opus-5";
  if (model.startsWith("claude-opus")) return "claude-sonnet-5";
  if (model === "claude-sonnet-5-5") return "claude-sonnet-5";
  if (model === "claude-sonnet-5") return "claude-sonnet-4-6";
  return undefined;
}

export function fallbackBannerHtml(from: string, to: string): string {
  return `<div class="kp-ev kp-ev-stage">${escHtml(from)} 额度用尽,本轮已自动改用 ${escHtml(to)} 重试(会话模型设置未变,要长期切换请用 /model)</div>`;
}
