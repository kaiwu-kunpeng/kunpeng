import type { Capture } from "./capture-store.js";

export const SYNTH_SYSTEM =
  "你是知识综述助手。把用户某个主题下的多张知识卡片,综述成一篇结构化中文简报:开头一句总览,然后 3-6 条要点(每条一句,后面用 [卡片id] 标来源),最后一句『可行动建议』。只综述资料里有的,别编。直接输出简报正文(markdown),不要额外说明。";

export function selectByTopic(captures: Capture[], topic: { category?: string; tag?: string }): Capture[] {
  return captures.filter((capture) => {
    if (topic.category) return capture.category === topic.category;
    if (topic.tag) return (capture.tags ?? []).includes(topic.tag);
    return false;
  });
}

export function buildSynthesizeInput(topicLabel: string, caps: Capture[]): string {
  const ctx = caps
    .map((capture) => `[${capture.id}] ${capture.title ?? capture.summary ?? ""}\n${String(capture.summary ?? capture.raw).slice(0, 800)}`)
    .join("\n\n---\n\n");
  return `主题：${topicLabel}\n\n【卡片资料】\n${ctx}`;
}
