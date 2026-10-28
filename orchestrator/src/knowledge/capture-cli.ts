import { ingest, type IngestDeps, type IngestInput } from "./ingest.js";
import { CaptureStore, type Capture as StoredCapture } from "./capture-store.js";
import { htmlToText } from "./html-to-text.js";

const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "of",
  "to",
  "is",
  "are",
  "in",
  "on",
  "for",
  "with",
  "as",
  "by",
  "it",
  "this",
  "that",
]);

export function heuristicSummarize(rawInput: string): { summary: string; tags: string[]; category?: string; title?: string } {
  // file/url 抓来的网页/.html:原文含标签 → 先转纯文本,否则摘要会切出 "<"、tags 全是 div/span/var 等标签名。
  const looksHtml = /<\/?[a-z!][^>]*>/i.test(rawInput);
  const raw = looksHtml ? htmlToText(rawInput) : rawInput;
  const trimmed = raw.trim();
  if (trimmed === "") return { summary: "", tags: [] };

  const firstSentence = (trimmed.split(/[。.!?！？\n]/)[0] ?? "").trim();
  const prefix = trimmed.slice(0, 160).trim();
  // 过滤退化候选(空 / 单字符 / 纯标点),避免摘要变成 "<" 之类。
  const candidates = [firstSentence, prefix].filter((value) => value.replace(/[^\p{L}\p{N}]/gu, "").length >= 2);
  const summary = candidates.length
    ? candidates.reduce((shortest, value) => value.length < shortest.length ? value : shortest)
    : trimmed.slice(0, 80);

  const stats = new Map<string, { count: number; firstIndex: number }>();
  const words = raw.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  for (const word of words) {
    if (word.length < 3 || STOP_WORDS.has(word)) continue;
    const existing = stats.get(word);
    if (existing) {
      existing.count += 1;
    } else {
      stats.set(word, { count: 1, firstIndex: stats.size });
    }
  }

  const tags = [...stats.entries()]
    .sort(([, a], [, b]) => b.count - a.count || a.firstIndex - b.firstIndex)
    .slice(0, 5)
    .map(([word]) => word);

  return { summary, tags };
}

export interface CaptureCliDeps {
  store: CaptureStore;
  fetchUrl: (url: string) => Promise<string>;
  readFile: (path: string) => Promise<string>;
  summarize?: (raw: string) => Promise<{ summary: string; tags: string[]; category?: string; title?: string }>;
  now: () => number;
  newId: () => string;
}

export interface CaptureArgs {
  kind: "text" | "url" | "file";
  value: string;
  projectId?: string;
  sourceProfileId?: string;
}

export type CaptureCliResult = StoredCapture & { duplicate?: boolean };

export async function runCapture(args: CaptureArgs, deps: CaptureCliDeps): Promise<CaptureCliResult> {
  const ingestDeps: IngestDeps = {
    summarize: deps.summarize ?? (async (raw) => heuristicSummarize(raw)),
    fetchUrl: deps.fetchUrl,
    readFile: deps.readFile,
    now: deps.now,
    newId: deps.newId,
  };
  const input: IngestInput =
    args.kind === "text" ? { kind: "text", text: args.value } :
    args.kind === "url" ? { kind: "url", url: args.value } :
    { kind: "file", path: args.value };

  const capture = await ingest(input, ingestDeps);
  const storedCapture: StoredCapture = {
    id: capture.id,
    source: capture.source,
    kind: args.kind,
    raw: capture.raw,
    title: capture.title,
    summary: capture.summary,
    tags: capture.tags,
    category: capture.category,
    projectId: args.projectId,
    sourceProfileId: args.sourceProfileId,
    citedFrom: capture.origin,
    createdAt: capture.capturedAt,
    promoted: false,
  };

  const appended = await deps.store.appendCapture(storedCapture);
  if (!appended) return { ...storedCapture, duplicate: true };

  return storedCapture;
}
