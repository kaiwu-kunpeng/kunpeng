export interface SpecMeta { filename: string; date: string; title: string; supersedes?: string; status?: string }
export interface SpecIndexEntry extends SpecMeta { superseded: boolean }
export interface SpecFamily { family: string; count: number; files: string[] }

/** 从文件名取 YYYY-MM-DD 前缀,从内容取首个 H1 标题、可选 `supersedes:`/`status:` 行。纯函数。 */
export function parseSpecMeta(filename: string, content: string): SpecMeta {
  const dateM = /^(\d{4}-\d{2}-\d{2})/.exec(filename);
  const titleM = /^#\s+(.+)$/m.exec(content);
  const supM = /^supersedes:\s*(.+)$/im.exec(content);
  const statusM = /^status:\s*(.+)$/im.exec(content);
  return {
    filename,
    date: dateM ? dateM[1] : "",
    title: titleM ? titleM[1].trim() : filename.replace(/\.md$/, ""),
    supersedes: supM ? supM[1].trim() : undefined,
    status: statusM ? statusM[1].trim() : undefined,
  };
}

/** 解析全部 spec,标出"被别的 spec 取代"的项,按日期降序(同日按文件名)排。纯函数。 */
export function buildSpecIndex(specs: { filename: string; content: string }[]): SpecIndexEntry[] {
  const metas = specs.map((s) => parseSpecMeta(s.filename, s.content));
  const supersededNames = new Set<string>();
  for (const m of metas) {
    if (m.supersedes) {
      supersededNames.add(m.supersedes);
      supersededNames.add(m.supersedes.endsWith(".md") ? m.supersedes : `${m.supersedes}.md`);
    }
  }
  return metas
    .map((m) => ({ ...m, superseded: supersededNames.has(m.filename) }))
    .sort((a, b) => b.date.localeCompare(a.date) || a.filename.localeCompare(b.filename));
}

/** 按"去日期后的首个 kebab 词"聚类，只保留达到 minSize 的族。纯函数。 */
export function groupByFamily(entries: SpecIndexEntry[], minSize = 3): SpecFamily[] {
  const byFamily = new Map<string, string[]>();
  for (const entry of entries) {
    const stem = entry.filename.replace(/^\d{4}-\d{2}-\d{2}-/, "").replace(/\.md$/, "");
    const family = stem.split("-")[0] || stem;
    const files = byFamily.get(family) ?? [];
    files.push(entry.filename);
    byFamily.set(family, files);
  }
  return [...byFamily.entries()]
    .filter(([, files]) => files.length >= minSize)
    .map(([family, files]) => ({ family, count: files.length, files: [...files].sort() }))
    .sort((a, b) => b.count - a.count || a.family.localeCompare(b.family));
}

/** 渲染 spec 索引(活跃 / 已被取代 两区)。 */
export function renderSpecIndex(entries: SpecIndexEntry[]): string {
  const active = entries.filter((e) => !e.superseded);
  const superseded = entries.filter((e) => e.superseded);
  const families = groupByFamily(entries);
  const head = ["| 日期 | 标题 | 状态 | 取代 | 文件 |", "|---|---|---|---|---|"];
  const row = (e: SpecIndexEntry): string =>
    `| ${e.date || "—"} | ${e.title.replace(/\|/g, "／").slice(0, 70)} | ${e.status ?? "—"} | ${e.supersedes ? `取代 ${e.supersedes}` : ""} | ${e.filename} |`;
  const out = [
    `# Spec 索引（${entries.length} 份，活跃 ${active.length}，已被取代 ${superseded.length}）`,
    "",
  ];
  if (families.length) {
    out.push("## 特性族（同前缀 ≥3 份；属功能分解，非版本重复）", "");
    for (const family of families) {
      out.push(`- **${family.family}**（${family.count} 份）：${family.files.join("、")}`);
    }
    out.push("");
  }
  out.push("## 活跃", "", ...head, ...active.map(row), "");
  if (superseded.length) out.push("## 已被取代", "", ...head, ...superseded.map(row), "");
  return out.join("\n") + "\n";
}
