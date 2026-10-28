import type { RetrieveHit } from "./retrieve.js";

export const ASK_SYSTEM =
  "你是基于知识库的问答助手。只用下面提供的【资料】回答用户问题,用中文,简洁有条理。每个关键论断后用 [卡片id] 标注来源(id 用资料里给的)。资料里没有的别编,没有就说『资料里没有』。";

export function buildAskInput(question: string, hits: RetrieveHit[]): string {
  const context = hits
    .map((h) => `[${h.capture.id}] ${h.capture.title ?? ""}\n${String(h.capture.text).slice(0, 1500)}`)
    .join("\n\n---\n\n");
  return `问题：${question}\n\n【资料】\n${context}`;
}
