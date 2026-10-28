/** 从已有 ADR 文件名(形如 NNNN-*.md)算下一个四位补零编号。空->"0001"。忽略不匹配前缀的文件。 */
export function nextAdrNumber(existingFilenames: string[]): string {
  let max = 0;
  for (const f of existingFilenames) {
    const m = /^(\d{4})-/.exec(f);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  }
  return String(max + 1).padStart(4, "0");
}

/** 标题转 kebab: 小写、非字母数字(含中文)折成单短横、去首尾横线。中文保留(URL/文件系统可)。 */
export function adrSlug(title: string): string {
  return title.trim().toLowerCase().replace(/[^a-z0-9一-龥]+/g, "-").replace(/^-+|-+$/g, "") || "decision";
}

export function adrFilename(num: string, title: string): string {
  return `${num}-${adrSlug(title)}.md`;
}

export interface AdrOptions {
  status?: string;
  supersedes?: string;
  dateISO: string;
}

/** 渲染一条 ADR(五要素)。status 缺省 "Proposed"。supersedes 给定则在 Context 注明取代关系。 */
export function renderAdr(num: string, title: string, opts: AdrOptions): string {
  const status = opts.status ?? "Proposed";
  const supLine = opts.supersedes ? `\n> 取代 ADR-${opts.supersedes}。\n` : "";
  return [
    `# ADR-${num}: ${title}`,
    "",
    `- **Status**: ${status}`,
    `- **Date**: ${opts.dateISO}`,
    supLine,
    "## Context",
    "",
    "_(决策背后的受力:问题、约束、相关事实)_",
    "",
    "## Decision",
    "",
    "_(我们决定做什么)_",
    "",
    "## Consequences",
    "",
    "_(由此带来的好处与代价)_",
    "",
  ].join("\n");
}

/** 渲染内容已填好的 ADR(用于 loop 自动生成,区别于 renderAdr 的占位模板)。 */
export function renderFilledAdr(
  num: string,
  title: string,
  opts: AdrOptions,
  sections: { context: string; decision: string; consequences: string },
): string {
  const supLine = opts.supersedes ? `\n> 取代 ADR-${opts.supersedes}。\n` : "";
  return [
    `# ADR-${num}: ${title}`,
    "",
    `- **Status**: ${opts.status ?? "Proposed"}`,
    `- **Date**: ${opts.dateISO}`,
    supLine,
    "## Context",
    "",
    sections.context,
    "",
    "## Decision",
    "",
    sections.decision,
    "",
    "## Consequences",
    "",
    sections.consequences,
    "",
  ].join("\n");
}

/** 把一条既有 ADR 的 Status 行改写为 "Superseded by ADR-NNNN"(唯一允许的对既有 ADR 修改)。
 *  找第一行 `- **Status**: ...` 替换; 找不到则在标题后补一行。
 */
export function supersedeStatus(content: string, byNum: string): string {
  const re = /- \*\*Status\*\*:.*/;
  if (re.test(content)) return content.replace(re, `- **Status**: Superseded by ADR-${byNum}`);
  return content.replace(/(^#.*\n)/, `$1\n- **Status**: Superseded by ADR-${byNum}\n`);
}
