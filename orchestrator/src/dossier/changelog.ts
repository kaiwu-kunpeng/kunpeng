export type ChangelogCategory = "Added" | "Changed" | "Deprecated" | "Removed" | "Fixed" | "Security";

const SKELETON = [
  "# Changelog",
  "",
  "本文件记录本项目所有值得注意的变更,遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/),版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。",
  "",
  "## [Unreleased]",
  "",
].join("\n");

export function categorize(commitType: string): ChangelogCategory {
  const t = commitType.trim().toLowerCase();
  if (t === "feat") return "Added";
  if (t === "fix") return "Fixed";
  if (t === "perf" || t === "refactor" || t === "docs" || t === "chore" || t === "style") return "Changed";
  if (t === "security") return "Security";
  if (t === "deprecate" || t === "deprecated") return "Deprecated";
  if (t === "remove" || t === "removed") return "Removed";
  return "Changed";
}

export function changelogEntryFromRequirement(requirement: string, flowId: string): { category: ChangelogCategory; entry: string } | null {
  const lines = requirement.split(/\r?\n/);
  const first = lines.find((line) => line.startsWith("# ")) ?? lines.find((line) => line.trim());
  let title = (first ?? "").trimStart().replace(/^#+/, "").replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
  if (!title) return null;
  const characters = [...title];
  if (characters.length > 120) title = characters.slice(0, 120).join("") + "…";

  let category: ChangelogCategory = "Changed";
  if (/安全|漏洞|越权|注入|SSRF|XSS|CSRF|鉴权|凭据|security/i.test(title)) category = "Security";
  else if (/修复|修正|缺陷|漏检|回归|误报|静默吞|\bfix\b|bug/i.test(title)) category = "Fixed";
  else if (/删除|移除|下线|退出版本库|\bremove/i.test(title)) category = "Removed";
  else if (/废弃|deprecat/i.test(title)) category = "Deprecated";
  else if (/新增|增加|支持|接入|引入|\badd\b/i.test(title)) category = "Added";
  return { category, entry: `${title}（${flowId}）` };
}

function ensureUnreleased(existing: string | null): string {
  const doc = existing && existing.includes("# Changelog") ? existing : SKELETON;
  if (doc.includes("## [Unreleased]")) return doc;
  if (doc.match(/^# Changelog\s*$/m)) {
    return doc.replace(/^# Changelog\s*$/m, "# Changelog\n\n## [Unreleased]");
  }
  return SKELETON;
}

export function addEntry(existing: string | null, category: ChangelogCategory, entry: string): string {
  const doc = ensureUnreleased(existing);
  const line = `- ${entry.trim()}`;
  const catHeader = `### ${category}`;
  const unrelIdx = doc.indexOf("## [Unreleased]");
  const afterUnrel = doc.indexOf("\n## ", unrelIdx + "## [Unreleased]".length);
  const sectionEnd = afterUnrel < 0 ? doc.length : afterUnrel;
  const section = doc.slice(unrelIdx, sectionEnd);
  const catIdx = section.indexOf(catHeader);

  if (catIdx >= 0) {
    const catContentStart = catIdx + catHeader.length;
    const nextCat = section.indexOf("\n### ", catContentStart);
    const catEnd = nextCat < 0 ? section.length : nextCat;
    const beforeCatEnd = section.slice(0, catEnd).replace(/\n+$/, "\n");
    const newSection = `${beforeCatEnd}${line}\n${section.slice(catEnd)}`;
    return `${doc.slice(0, unrelIdx)}${newSection}${doc.slice(sectionEnd)}`;
  }

  const trimmedSection = section.replace(/\n+$/, "\n");
  const newSection = `${trimmedSection}\n${catHeader}\n${line}\n`;
  return `${doc.slice(0, unrelIdx)}${newSection}${doc.slice(sectionEnd)}`;
}
