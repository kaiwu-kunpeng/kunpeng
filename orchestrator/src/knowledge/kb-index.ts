import type { Capture } from "./capture-store.js";

export interface ProjectCaptures { projectId: string; projectName: string; captures: Capture[] }
export interface KbEntry {
  id: string; projectId: string; projectName: string;
  summary: string; tags: string[]; source: string; createdAt: number;
}

function pushCapture(out: KbEntry[], seen: Set<string>, projectId: string, projectName: string, capture: Capture, query?: string): void {
  if (seen.has(capture.id)) return;
  const summary = capture.summary ?? capture.title ?? capture.raw ?? "";
  if (query) {
    const hay = `${summary} ${capture.raw ?? ""} ${(capture.tags ?? []).join(" ")}`.toLowerCase();
    if (!hay.includes(query)) return;
  }
  seen.add(capture.id);
  out.push({
    id: capture.id,
    projectId,
    projectName,
    summary,
    tags: capture.tags ?? [],
    source: capture.source,
    createdAt: capture.createdAt,
  });
}

/** 各项目 captures 拍平成统一索引:按 id 去重(同 id 取先出现)、按 createdAt 降序;
 *  query 给定则只留 summary/raw/tags 命中(小写包含)的条目。纯函数。 */
export function aggregateCaptures(perProject: ProjectCaptures[], query?: string, globalCaptures?: Capture[]): KbEntry[] {
  const q = query?.trim().toLowerCase();
  const seen = new Set<string>();
  const out: KbEntry[] = [];
  for (const p of perProject) {
    for (const c of p.captures) {
      pushCapture(out, seen, p.projectId, p.projectName, c, q);
    }
  }
  for (const c of globalCaptures ?? []) {
    pushCapture(out, seen, "global", "全局知识池", c, q);
  }
  out.sort((a, b) => b.createdAt - a.createdAt);
  return out;
}

/** 渲染聚合索引为 markdown 表。 */
export function renderKbIndex(entries: KbEntry[], query?: string): string {
  const header = query
    ? `# 跨项目知识库索引 · 过滤「${query}」(${entries.length} 条)`
    : `# 跨项目知识库索引(${entries.length} 条)`;
  if (entries.length === 0) return `${header}\n\n_(无匹配条目)_\n`;
  const rows = [
    "| 项目 | 摘要 | 标签 | 来源 | id |",
    "|---|---|---|---|---|",
    ...entries.map((e) =>
      `| ${e.projectName} | ${e.summary.replace(/\|/g, "／").replace(/\n/g, " ").slice(0, 80)} | ${e.tags.slice(0, 5).join(", ")} | ${e.source} | ${e.id} |`),
  ];
  return `${header}\n\n${rows.join("\n")}\n`;
}

export interface KbResponse { count: number; projectCount: number; entries: KbEntry[] }

/** 组装 /api/kb 响应:聚合 + 计数。纯函数(便于测)。 */
export function buildKbResponse(perProject: ProjectCaptures[], query?: string, globalCaptures?: Capture[]): KbResponse {
  const entries = aggregateCaptures(perProject, query, globalCaptures);
  return { count: entries.length, projectCount: perProject.length, entries };
}
