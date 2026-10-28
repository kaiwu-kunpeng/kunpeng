import { isRecord } from "../util/is-record.js";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";

export interface LessonEntry {
  id: string;
  title: string;
  description: string;
  content: string;
  polarity: "success" | "failure" | "contrast";
  evidence: string;
  signature?: string;
  projectId?: string;
  sourceIds: string[];
  trustTier: 0 | 1 | 2;
  stats: { injected: number; wins: number; losses: number };
  createdAt: number;
}

const POLARITIES = new Set<LessonEntry["polarity"]>(["success", "failure", "contrast"]);
const TRUST_TIERS = new Set<LessonEntry["trustTier"]>([0, 1, 2]);

function lessonsPath(stateDir: string): string {
  return join(stateDir, "skills", "lessons.jsonl");
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function parseLesson(value: unknown, context: string): LessonEntry {
  if (!isRecord(value) || !isRecord(value.stats)) {
    throw new Error(`无效 Lesson 记录 (${context})`);
  }
  const requiredStrings = ["id", "title", "description", "content", "evidence"] as const;
  for (const key of requiredStrings) {
    if (typeof value[key] !== "string" || value[key].trim() === "") {
      throw new Error(`无效 Lesson 记录 (${context}): ${key} 必须是非空字符串`);
    }
  }
  if (!POLARITIES.has(value.polarity as LessonEntry["polarity"])) {
    throw new Error(`无效 Lesson 记录 (${context}): polarity`);
  }
  if (!TRUST_TIERS.has(value.trustTier as LessonEntry["trustTier"])) {
    throw new Error(`无效 Lesson 记录 (${context}): trustTier`);
  }
  if (!Array.isArray(value.sourceIds) || value.sourceIds.some((id) => typeof id !== "string" || id.trim() === "")) {
    throw new Error(`无效 Lesson 记录 (${context}): sourceIds`);
  }
  if (
    !isNonNegativeInteger(value.stats.injected)
    || !isNonNegativeInteger(value.stats.wins)
    || !isNonNegativeInteger(value.stats.losses)
  ) {
    throw new Error(`无效 Lesson 记录 (${context}): stats`);
  }
  if (typeof value.createdAt !== "number" || !Number.isFinite(value.createdAt)) {
    throw new Error(`无效 Lesson 记录 (${context}): createdAt`);
  }
  if (value.signature !== undefined && (typeof value.signature !== "string" || value.signature.trim() === "")) {
    throw new Error(`无效 Lesson 记录 (${context}): signature`);
  }
  if (value.projectId !== undefined && (typeof value.projectId !== "string" || value.projectId.trim() === "")) {
    throw new Error(`无效 Lesson 记录 (${context}): projectId`);
  }
  return value as unknown as LessonEntry;
}

export async function listLessons(stateDir: string): Promise<LessonEntry[]> {
  let text: string;
  try {
    text = await readFile(lessonsPath(stateDir), "utf8");
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") return [];
    throw error;
  }
  if (text.trim() === "") return [];
  return text.split(/\r?\n/).flatMap((line, index) => {
    if (line.trim() === "") return [];
    try {
      const parsed = JSON.parse(line) as unknown;
      return [parseLesson(parsed, `第 ${index + 1} 行`)];
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`lessons.jsonl 第 ${index + 1} 行损坏: ${reason}`);
      return [];
    }
  });
}

async function replaceLessons(path: string, entries: LessonEntry[]): Promise<void> {
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n", "utf8");
  await rename(tmp, path);
}

export async function appendLesson(stateDir: string, entry: LessonEntry): Promise<void> {
  const valid = parseLesson(entry, "appendLesson 输入");
  const path = lessonsPath(stateDir);
  await mkdir(dirname(path), { recursive: true });
  const existing = await listLessons(stateDir);
  const duplicateIndex = existing.findIndex((candidate) =>
    valid.signature !== undefined
      ? candidate.signature === valid.signature
      : candidate.signature === undefined && candidate.id === valid.id,
  );
  if (duplicateIndex < 0) {
    await appendFile(path, `${JSON.stringify(valid)}\n`, "utf8");
    return;
  }

  const previous = existing[duplicateIndex]!;
  existing[duplicateIndex] = {
    ...previous,
    sourceIds: [...new Set([...previous.sourceIds, ...valid.sourceIds])],
    createdAt: valid.createdAt,
  };
  await replaceLessons(path, existing);
}

function occurrences(text: string, term: string): number {
  let count = 0;
  let from = 0;
  while (term !== "") {
    const index = text.indexOf(term, from);
    if (index < 0) break;
    count += 1;
    from = index + term.length;
  }
  return count;
}

function queryTerms(query: string): string[] {
  const normalized = query.toLocaleLowerCase().trim();
  if (normalized === "") return [];
  const words = normalized.match(/[\p{L}\p{N}_-]+/gu) ?? [];
  return [...new Set([normalized, ...words].filter((term) => term.length > 0))];
}

export async function searchLessons(
  stateDir: string,
  query: string,
  k = 2,
  opts: { minTrustTier?: LessonEntry["trustTier"] } = {},
): Promise<LessonEntry[]> {
  const minTier = opts.minTrustTier ?? 1;
  if (!Number.isFinite(k) || k <= 0) return [];
  const terms = queryTerms(query);
  if (terms.length === 0) return [];
  const lessons = await listLessons(stateDir);
  return lessons
    .filter((lesson) => lesson.trustTier >= minTier)
    .map((lesson, index) => {
      const fields = [lesson.title, lesson.description, lesson.content, lesson.evidence]
        .map((field) => field.toLocaleLowerCase());
      const score = terms.reduce((total, term) => total + fields.reduce((fieldTotal, field, fieldIndex) =>
        fieldTotal + occurrences(field, term) * (fieldIndex === 0 ? 2 : 1), 0), 0);
      return { lesson, index, score };
    })
    .filter((result) => result.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, Math.floor(k))
    .map((result) => result.lesson);
}
