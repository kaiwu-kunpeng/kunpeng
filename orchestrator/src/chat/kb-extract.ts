import type { ChatTurn } from "./conversation-store.js";

/** URL 提取正则（导出供测试）。 */
const URL_RE = /https?:\/\/[^\s)）"'<>]+/g;

export interface ExtractedItem {
  text: string; // 待沉淀的助手回复正文
  citedFrom?: string; // 命中的首个 URL（若有）
  reason: "web" | "url";
}

/** 识别「搜寻的数据」：web===true 的轮次、或助手回复含 URL 的轮次。纯函数、可单测。 */
export function extractSearchedData(turns: ChatTurn[]): ExtractedItem[] {
  const items: ExtractedItem[] = [];
  for (const turn of turns) {
    if (turn.role !== "assistant") continue;

    URL_RE.lastIndex = 0;
    const citedFrom = URL_RE.exec(turn.text)?.[0];
    URL_RE.lastIndex = 0;

    if (turn.web === true || citedFrom !== undefined) {
      items.push({
        text: turn.text,
        ...(citedFrom !== undefined ? { citedFrom } : {}),
        reason: turn.web === true ? "web" : "url",
      });
    }
  }
  return items;
}
