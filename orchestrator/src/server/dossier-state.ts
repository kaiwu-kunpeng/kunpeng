import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { buildSpecIndex, groupByFamily, type SpecFamily } from "../dossier/spec-index.js";

export interface ProjectMdView {
  northStar: string;
  goals: string;
  roadmap: { now: string; next: string; later: string };
}

export interface ChangelogUnreleased {
  categories: { name: string; items: string[] }[];
  total: number;
}

export interface AdrItem {
  num: string;
  title: string;
  status: string;
  date: string;
}

/** 从 PROJECT.md 人写区提北极星/目标/roadmap。容错:取不到给空串。
 *  约定格式:`**北极星**：xxx` / `**当期目标**：xxx` / `**Now:** xxx` / `**Next:** xxx` / `**Later:** xxx`。 */
export function parseProjectMd(content: string): ProjectMdView {
  const pick = (re: RegExp): string => {
    const m = re.exec(content);
    return m ? m[1].trim() : "";
  };
  return {
    northStar: pick(/\*\*北极星\*\*[：:]\s*(.+)/),
    goals: pick(/\*\*当期目标\*\*[：:]\s*(.+)/),
    roadmap: {
      now: pick(/\*\*Now[:：]\*\*\s*(.+)/i),
      next: pick(/\*\*Next[:：]\*\*\s*(.+)/i),
      later: pick(/\*\*Later[:：]\*\*\s*(.+)/i),
    },
  };
}

/** 提 CHANGELOG 的 [Unreleased] 段,按 `### 类目` 分组列条目。无 Unreleased→空。 */
export function parseChangelogUnreleased(content: string): ChangelogUnreleased {
  const start = content.indexOf("## [Unreleased]");
  if (start < 0) return { categories: [], total: 0 };
  const after = start + "## [Unreleased]".length;
  const nextVer = content.indexOf("\n## ", after);
  const section = content.slice(after, nextVer < 0 ? content.length : nextVer);
  const categories: { name: string; items: string[] }[] = [];
  let total = 0;
  const re = /^###\s+(.+)$/gm;
  const heads: { name: string; idx: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(section))) heads.push({ name: m[1].trim(), idx: m.index });
  for (let i = 0; i < heads.length; i++) {
    const body = section.slice(heads[i].idx, i + 1 < heads.length ? heads[i + 1].idx : section.length);
    const items = body
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("- "))
      .map((l) => l.slice(2).trim());
    if (items.length) {
      categories.push({ name: heads[i].name, items });
      total += items.length;
    }
  }
  return { categories, total };
}

/** 从 ADR 文件名(NNNN-*.md)+内容 提元数据,按 num 降序(新在前)。 */
export function parseAdrList(files: { filename: string; content: string }[]): AdrItem[] {
  const out: AdrItem[] = [];
  for (const f of files) {
    const numM = /^(\d{4})-/.exec(f.filename);
    if (!numM) continue;
    const titleM = /^#\s*ADR-\d+:\s*(.+)$/m.exec(f.content) ?? /^#\s+(.+)$/m.exec(f.content);
    const statusM = /-\s*\*\*Status\*\*[：:]\s*(.+)/.exec(f.content);
    const dateM = /-\s*\*\*Date\*\*[：:]\s*(.+)/.exec(f.content);
    out.push({
      num: numM[1],
      title: titleM ? titleM[1].trim() : f.filename.replace(/\.md$/, ""),
      status: statusM ? statusM[1].trim() : "",
      date: dateM ? dateM[1].trim() : "",
    });
  }
  return out.sort((a, b) => b.num.localeCompare(a.num));
}

export interface DossierOverview {
  project: ProjectMdView;
  changelog: ChangelogUnreleased;
  adrs: AdrItem[];
  specFamilies: SpecFamily[];
  specTotal: number;
  ostNorthStar?: { outcome: string; metric: string };
}

/** 读一个 repo 的档案层文件，组合成概览数据。全 best-effort：文件缺/坏只让对应块为空。 */
export async function collectDossierOverview(repoRoot: string): Promise<DossierOverview> {
  const safeRead = async (path: string): Promise<string> => {
    try {
      return await readFile(path, "utf8");
    } catch {
      return "";
    }
  };

  const project = parseProjectMd(await safeRead(join(repoRoot, "PROJECT.md")));
  const changelog = parseChangelogUnreleased(await safeRead(join(repoRoot, "CHANGELOG.md")));

  const adrs = await (async (): Promise<AdrItem[]> => {
    const dir = join(repoRoot, "docs", "decisions");
    const files = (await readdir(dir)).filter((file) => file.endsWith(".md"));
    const loaded = await Promise.all(files.map(async (file) => ({
      filename: file,
      content: await safeRead(join(dir, file)),
    })));
    return parseAdrList(loaded).slice(0, 5);
  })().catch(() => []);

  const specIndex = await (async () => {
    const dir = join(repoRoot, "docs", "specs");
    const files = (await readdir(dir)).filter((file) => file.endsWith(".md"));
    const loaded = await Promise.all(files.map(async (file) => ({
      filename: file,
      content: await safeRead(join(dir, file)),
    })));
    return buildSpecIndex(loaded);
  })().catch(() => []);
  const specTotal = specIndex.length;
  const specFamilies: SpecFamily[] = groupByFamily(specIndex).slice(0, 8);

  let ostNorthStar: { outcome: string; metric: string } | undefined;
  try {
    const raw = await safeRead(join(repoRoot, ".kunpeng", "product", "ost-tree.json"));
    if (raw) {
      const obj = JSON.parse(raw) as { tree?: { northStar?: { outcome?: string; metric?: string } } };
      const ns = obj.tree?.northStar;
      if (ns && (ns.outcome || ns.metric)) {
        ostNorthStar = { outcome: ns.outcome ?? "", metric: ns.metric ?? "" };
      }
    }
  } catch {
    ostNorthStar = undefined;
  }

  return { project, changelog, adrs, specFamilies, specTotal, ostNorthStar };
}
