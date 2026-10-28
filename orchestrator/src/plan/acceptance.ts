/** 从一段 flow 文本里提取显式验收命令（```accept 块 或 验收:/Acceptance: 行）；无则 null。纯函数。 */
export function extractAcceptance(sectionText: string): string | null {
  const fence = /```accept\s*\n([\s\S]*?)\n```/.exec(sectionText);
  if (fence) { const cmd = fence[1].trim(); if (cmd) return cmd; }
  for (const line of sectionText.split("\n")) {
    const m = /^\s*(?:验收|Acceptance)\s*[:：]\s*(.+?)\s*$/.exec(line);
    if (m && m[1].trim()) return m[1].trim();
  }
  return null;
}

/** 给小 agent 的翻译提示：把方案段翻成一条可执行验收命令（只输出命令）。纯函数。 */
export function translationPrompt(requirement: string): string {
  return [
    "把下面这段方案需求翻译成一条**可执行的验收验证命令**（shell 可直接跑，退出码 0 = 通过）。",
    "只输出命令本身，不要解释、不要 markdown 代码块包裹。",
    "",
    requirement,
  ].join("\n");
}
