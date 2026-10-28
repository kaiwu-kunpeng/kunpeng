import matter from "gray-matter";
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { withDirLock } from "../taskboard/lock.js";
import { writeFileAtomic } from "../util/atomic-write.js";
import { Artifact, TRANSITIONS, type ArtifactKind, type ArtifactStatus } from "./types.js";

const warnedBroken = new Map<string, Set<string>>();

export function summarizeParseError(e: unknown): string {
  let message: string;
  if (typeof e === "object" && e !== null && Array.isArray((e as { issues?: unknown }).issues)) {
    const { issues } = e as { issues: { path: (string | number)[]; message: string }[] };
    message = issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
  } else {
    message = e instanceof Error ? e.message : String(e);
  }
  return message.replace(/\r?\n/g, " ").trim();
}

export interface ArtifactSummary {
  id: string;
  kind: ArtifactKind;
  status: ArtifactStatus;
  meta: Record<string, unknown>;
  summary: string;
}

function summarizeArtifactBody(body: string): string {
  return (body.split("\n").find((l) => l.trim()) ?? "").slice(0, 120);
}

function artifactSummary(a: Artifact): ArtifactSummary {
  return {
    id: a.id,
    kind: a.kind,
    status: a.status,
    meta: a.meta,
    summary: summarizeArtifactBody(a.body),
  };
}

function sameStringSet(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) return false;
  for (const item of left) {
    if (!right.has(item)) return false;
  }
  return true;
}

export class ArtifactStore {
  constructor(private dir: string) {}

  private path(id: string) { return join(this.dir, `${id}.md`); }

  private summaryIndexPath() { return join(this.dir, "_summary-index.json"); }

  private async readSummaryIndex(onError: Record<string, ArtifactSummary> | null): Promise<Record<string, ArtifactSummary> | null> {
    try {
      return JSON.parse(await readFile(this.summaryIndexPath(), "utf8")) as Record<string, ArtifactSummary>;
    } catch {
      return onError;
    }
  }

  private async writeSummaryIndex(index: Record<string, ArtifactSummary>): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFileAtomic(this.summaryIndexPath(), JSON.stringify(index, null, 2));
  }

  private async writeUnlocked(a: Artifact): Promise<Artifact> {
    const parsed = Artifact.parse(a);
    await mkdir(this.dir, { recursive: true });
    const { body, ...fm } = parsed;
    // 治本：body 前置换行哨兵，防 gray-matter 把以 `---` 开头的正文误当 frontmatter 整段吞掉（数据丢失）。
    // read 的 content.trimStart() 把哨兵连同前导空白一起去掉、完整还原（提案/方案正文前导空白无意义）。
    await writeFileAtomic(this.path(parsed.id), matter.stringify("\n" + body, fm));
    const index = (await this.readSummaryIndex({})) ?? {};
    index[parsed.id] = artifactSummary(parsed);
    await this.writeSummaryIndex(index);
    return parsed;
  }

  async write(a: Artifact): Promise<Artifact> {
    return withDirLock(this.dir, () => this.writeUnlocked(a));
  }

  async read(id: string): Promise<Artifact> {
    const raw = await readFile(this.path(id), "utf8");
    const { data, content } = matter(raw);
    return Artifact.parse({ ...data, body: content.trimStart() });
  }

  async list(kind?: import("./types.js").ArtifactKind): Promise<Artifact[]> {
    const { readdir } = await import("node:fs/promises");
    const files = (await readdir(this.dir).catch(() => [])).filter((f) => f.endsWith(".md"));
    const storeDir = resolve(this.dir);
    let warned = warnedBroken.get(storeDir);
    if (!warned) {
      warned = new Set<string>();
      warnedBroken.set(storeDir, warned);
    }
    const warnedFiles = warned;
    // 容错：单个坏 artifact（如 schema 外的遗留 status）不得拖垮整张清单——否则 collectState 抛错、总控台整盘空白。
    // 同一文件只记一行警告；解析成功后清除记录，再次损坏时重新告警。
    const settled = await Promise.all(files.map(async (f) => {
      try {
        const artifact = await this.read(f.replace(/\.md$/, ""));
        warnedFiles.delete(f);
        return artifact;
      } catch (e) {
        if (!warnedFiles.has(f)) {
          console.error(`[artifacts] 跳过无法解析的 artifact ${f}：${summarizeParseError(e)}（同一文件只提示一次）`);
          warnedFiles.add(f);
        }
        return null;
      }
    }));
    const arts = settled.filter((a): a is Artifact => a !== null);
    return kind ? arts.filter((a) => a.kind === kind) : arts;
  }

  async listSummaries(kind?: ArtifactKind): Promise<ArtifactSummary[]> {
    const { readdir } = await import("node:fs/promises");
    const artifactIds = new Set(
      (await readdir(this.dir).catch(() => []))
        .filter((f) => f.endsWith(".md") && f !== "_summary-index.json")
        .map((f) => f.replace(/\.md$/, "")),
    );
    let index = await this.readSummaryIndex(null);
    if (index === null || !sameStringSet(new Set(Object.keys(index)), artifactIds)) {
      const artifacts = await this.list();
      index = Object.fromEntries(artifacts.map((a) => [a.id, artifactSummary(a)]));
      await this.writeSummaryIndex(index);
    }
    const summaries = Object.values(index);
    return kind ? summaries.filter((a) => a.kind === kind) : summaries;
  }

  /** 合并元数据并按当前状态写回（不触发状态转移）。 */
  async patchMeta(id: string, metaUpdate: Record<string, unknown>): Promise<Artifact> {
    return withDirLock(this.dir, async () => {
      const cur = await this.read(id);
      return this.writeUnlocked({ ...cur, meta: { ...cur.meta, ...metaUpdate } });
    });
  }

  async transition(id: string, to: ArtifactStatus): Promise<Artifact> {
    return withDirLock(this.dir, async () => {
      const cur = await this.read(id);
      if (!TRANSITIONS[cur.status].includes(to)) {
        throw new Error(`illegal transition: ${cur.status} -> ${to} (${id})`);
      }
      return this.writeUnlocked({ ...cur, status: to });
    });
  }
}
