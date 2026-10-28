import type { ResearchFinding } from "../research/types.js";

export function formatSuggestions(project: string, findings: ResearchFinding[], generatedAt: string): string {
  const head = `# ${project} · 研究建议(scout)\n\n> 生成于 ${generatedAt};下次 onboard 自动注入,仅供参考、不自动执行。\n`;
  if (findings.length === 0) return `${head}\n（本轮无新发现）\n`;
  const blocks = findings.map((f) => {
    const lines = [`## ${f.topic}`, `- 摘要：${f.summary}`, `  - 来源：${f.source}`];
    if (f.suggestedConvention) lines.push(`  - 建议约定：${f.suggestedConvention}`);
    if (f.suggestedUpgrade) lines.push(`  - 建议升级：${f.suggestedUpgrade}`);
    return lines.join("\n");
  });
  return `${head}\n${blocks.join("\n\n")}\n`;
}
