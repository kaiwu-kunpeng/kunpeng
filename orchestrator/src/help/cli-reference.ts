const INDEX_START = "<!-- cli-index:start -->";
const INDEX_END = "<!-- cli-index:end -->";

export function renderCliIndex(names: readonly string[]): string {
  const sorted = [...new Set(names)].sort();
  return [
    INDEX_START,
    `共 ${sorted.length} 个命令：${sorted.map((name) => `\`${name}\``).join(" · ")}`,
    INDEX_END,
  ].join("\n");
}

export function syncCliIndex(doc: string, names: readonly string[]): string {
  const start = doc.indexOf(INDEX_START);
  const end = doc.indexOf(INDEX_END, start + INDEX_START.length);
  if (start === -1 || end === -1) {
    throw new Error("缺少完整的 cli-index 标记对");
  }
  return doc.slice(0, start) + renderCliIndex(names) + doc.slice(end + INDEX_END.length);
}
