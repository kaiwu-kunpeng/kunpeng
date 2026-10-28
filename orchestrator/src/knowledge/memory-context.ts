import { extractQueryTerms, selectRelevant, type RelevanceEntry } from "./kb-relevance.js";
import { retrieveCaptures, type Capture } from "./retrieve.js";

const MEMORY_ADVISORY_PREFIX = "以下是过往记忆,可能有用也可能不适用;先判断是否与当前任务相关,再决定采纳。";

export interface MemoryCapture extends RelevanceEntry {
  tags: string[];
  summary: string;
}

export interface Bm25MemoryCapture {
  raw: string;
  title?: string;
  summary?: string;
  tags: string[];
  promoted?: boolean;
  distillLevel?: number;
}

function trimSummary(summary: string): string {
  const trimmed = summary.trim();
  if (trimmed.length <= 200) return trimmed;
  return `${trimmed.slice(0, 200)}…`;
}

export function buildMemoryContext(
  captures: MemoryCapture[],
  requirement: string,
  opts?: { k?: number; minScore?: number; maxChars?: number },
): string {
  const terms = extractQueryTerms(requirement);
  const picked = selectRelevant(captures, terms, { k: opts?.k ?? 2, minScore: opts?.minScore ?? 1 });
  if (picked.length === 0) return "";

  const maxChars = opts?.maxChars ?? 1200;
  const lines = [MEMORY_ADVISORY_PREFIX, "## 相关经验（方法论资产）", `· ${trimSummary(picked[0].summary)}`];

  for (const capture of picked.slice(1)) {
    const line = `· ${trimSummary(capture.summary)}`;
    const next = [...lines, line].join("\n");
    if (next.length > maxChars) break;
    lines.push(line);
  }

  return lines.join("\n");
}

function longestText(capture: Bm25MemoryCapture): string {
  const candidates = [capture.summary, capture.raw].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  if (candidates.length === 0) return capture.raw;
  return candidates.sort((a, b) => b.length - a.length)[0];
}

function renderBm25Summary(capture: Bm25MemoryCapture): string {
  const text = capture.summary?.trim() || capture.title?.trim() || capture.raw;
  return trimSummary(text);
}

function distillMultiplier(level: number | undefined): number {
  return 1 + 0.2 * Math.min(level ?? 0, 3);
}

export function buildMemoryContextBM25(
  captures: Bm25MemoryCapture[],
  requirement: string,
  opts?: { k?: number; maxChars?: number },
): string {
  const mapped: Capture[] = captures.map((capture, index) => ({
    id: `mem-${index}`,
    source: `memory:${index}`,
    text: longestText(capture),
    tags: capture.tags,
    title: capture.title,
  }));
  const byId = new Map(mapped.map((capture, index) => [capture.id, captures[index]]));
  const hits = retrieveCaptures(requirement, mapped, { limit: 32 })
    .map((hit) => {
      const source = byId.get(hit.capture.id);
      const finalScore = hit.score * (source?.promoted === true ? 1.5 : 1) * distillMultiplier(source?.distillLevel);
      return { capture: source, finalScore };
    })
    .filter(
      (hit): hit is { capture: Bm25MemoryCapture; finalScore: number } =>
        hit.capture !== undefined && hit.finalScore > 0,
    )
    .sort((a, b) => b.finalScore - a.finalScore)
    .slice(0, opts?.k ?? 2);

  if (hits.length === 0) return "";

  const maxChars = opts?.maxChars ?? 1200;
  const lines = ["## 相关经验（方法论资产）", MEMORY_ADVISORY_PREFIX, `· ${renderBm25Summary(hits[0].capture)}`];

  for (const hit of hits.slice(1)) {
    const line = `· ${renderBm25Summary(hit.capture)}`;
    const next = [...lines, line].join("\n");
    if (next.length > maxChars) break;
    lines.push(line);
  }

  return lines.join("\n");
}
