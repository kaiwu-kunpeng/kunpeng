import { createHash } from "node:crypto";
import { open, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { CliRunner } from "../agent/cli-runner.js";
import type { AgentRequest } from "../agent/runner.js";
import { failureSignature } from "../metrics/failure-signature.js";
import { readRecentFailureItems } from "../metrics/flow-failures.js";
import { resolveProjectStateDir } from "../project/state-resolve.js";
import { appendLesson, type LessonEntry } from "./lesson-store.js";

export interface LessonPromptInput {
  goal: string;
  trajectoryTail: string;
  signature: string;
}

export interface ParseLessonMeta {
  goal: string;
  trajectoryTail: string;
  signature: string;
  sourceIds: string[];
  projectId?: string;
  createdAt?: number;
  polarity?: LessonEntry["polarity"];
  trustTier?: LessonEntry["trustTier"];
}

export interface ContrastPromptInput {
  goal: string;
  failedTail: string;
  succeededTail: string;
}

export interface ParseContrastLessonMeta {
  failedTail: string;
  succeededTail: string;
  sourceIds: string[];
  goal?: string;
  signature?: string;
  projectId?: string;
  createdAt?: number;
}

interface LessonRunner {
  run(req: AgentRequest): Promise<{ text: string }>;
}

export interface DistillFailureLessonsOptions {
  stateDir?: string;
  days?: number;
  now?: number;
  runner?: LessonRunner;
  projectId?: string;
}

export interface DistillFailureLessonsResult {
  attempted: number;
  written: number;
  skipped: number;
}

interface FlowSource {
  flowId: string;
  requirement?: string;
  logPath?: string;
}

const MAX_LOG_TAIL_BYTES = 8 * 1024;

export function buildLessonPrompt(input: LessonPromptInput): string {
  return [
    "你是失败教训蒸馏器。只提炼可跨任务复用、且被给定轨迹直接支持的守则。",
    "最多提取 2 条",
    "不嵌入具体路径/id/字面量",
    "每条必须附 Evidence:从轨迹中逐字引用支撑该教训的一行",
    "若轨迹信息不足以支撑任何可靠教训,只输出 NO_LESSON",
    "输出格式严格为:",
    "# Lesson",
    "## Title",
    "## Description",
    "## Content",
    "## Evidence",
    `目标:\n${input.goal}`,
    `失败签名:\n${input.signature}`,
    `轨迹尾部:\n${input.trajectoryTail}`,
  ].join("\n");
}

export function buildContrastPrompt(input: ContrastPromptInput): string {
  return [
    "你是失败与成功轨迹的对比教训蒸馏器。只提取由两条轨迹中可观察差异直接支撑的可复用策略。",
    "最多提取 2 条",
    "每条 Evidence 必须分别从两条轨迹各逐字引用一行(格式: FAIL: <行> / PASS: <行>)",
    "若两条轨迹差异不足以支撑可靠结论,只输出 NO_LESSON",
    "输出格式严格为:",
    "# Lesson",
    "## Title",
    "## Description",
    "## Content",
    "## Evidence",
    `目标:\n${input.goal}`,
    `失败轨迹尾部:\n${input.failedTail}`,
    `成功轨迹尾部:\n${input.succeededTail}`,
  ].join("\n");
}

function section(block: string, name: string): string | undefined {
  const heading = new RegExp(`^## ${name}(?:[ \\t]+(.*))?$`, "m");
  const match = heading.exec(block);
  if (!match) return undefined;
  const start = match.index + match[0].length;
  const remainder = block.slice(start);
  const nextHeading = remainder.search(/^## |^# Lesson\s*$/m);
  const following = (nextHeading < 0 ? remainder : remainder.slice(0, nextHeading)).trim();
  return [match[1]?.trim(), following].filter(Boolean).join("\n").trim() || undefined;
}

function lessonId(meta: ParseLessonMeta, title: string, content: string, evidence: string): string {
  const digest = createHash("sha256")
    .update(JSON.stringify([meta.signature, meta.sourceIds, title, content, evidence]))
    .digest("hex")
    .slice(0, 20);
  return `lesson-${digest}`;
}

export function parseLessons(llmText: string, meta: ParseLessonMeta): LessonEntry[] {
  if (llmText.trim() === "NO_LESSON") return [];
  const starts = [...llmText.matchAll(/^# Lesson\s*$/gm)].map((match) => match.index!);
  const entries: LessonEntry[] = [];
  for (let index = 0; index < starts.length && entries.length < 2; index++) {
    const block = llmText.slice(starts[index]!, starts[index + 1] ?? llmText.length);
    const title = section(block, "Title");
    const description = section(block, "Description");
    const content = section(block, "Content");
    const evidence = section(block, "Evidence");
    if (!title || !description || !content || !evidence) continue;
    if (!meta.trajectoryTail.includes(evidence)) continue;
    entries.push({
      id: lessonId(meta, title, content, evidence),
      title,
      description,
      content,
      polarity: meta.polarity ?? "failure",
      evidence,
      signature: meta.signature,
      ...(meta.projectId !== undefined ? { projectId: meta.projectId } : {}),
      sourceIds: [...new Set(meta.sourceIds)],
      trustTier: meta.trustTier ?? 1,
      stats: { injected: 0, wins: 0, losses: 0 },
      createdAt: meta.createdAt ?? Date.now(),
    });
  }
  return entries;
}

export function parseContrastLessons(llmText: string, meta: ParseContrastLessonMeta): LessonEntry[] {
  if (llmText.trim() === "NO_LESSON") return [];
  const starts = [...llmText.matchAll(/^# Lesson\s*$/gm)].map((match) => match.index!);
  const entries: LessonEntry[] = [];
  for (let index = 0; index < starts.length && entries.length < 2; index++) {
    const block = llmText.slice(starts[index]!, starts[index + 1] ?? llmText.length);
    const title = section(block, "Title");
    const description = section(block, "Description");
    const content = section(block, "Content");
    const evidence = section(block, "Evidence");
    if (!title || !description || !content || !evidence) continue;
    const evidenceMatch = /^FAIL:\s*([^\r\n]+?)\s*\/\s*PASS:\s*([^\r\n]+)$/.exec(evidence);
    if (!evidenceMatch) continue;
    const failedEvidence = evidenceMatch[1]!.trim();
    const succeededEvidence = evidenceMatch[2]!.trim();
    if (!failedEvidence || !succeededEvidence) continue;
    if (!meta.failedTail.includes(failedEvidence) || !meta.succeededTail.includes(succeededEvidence)) continue;
    const digest = createHash("sha256")
      .update(JSON.stringify(["contrast", meta.signature, meta.sourceIds, title, content, evidence]))
      .digest("hex")
      .slice(0, 20);
    entries.push({
      id: `lesson-${digest}`,
      title,
      description,
      content,
      polarity: "contrast",
      evidence,
      ...(meta.signature !== undefined ? { signature: meta.signature } : {}),
      ...(meta.projectId !== undefined ? { projectId: meta.projectId } : {}),
      sourceIds: [...new Set(meta.sourceIds)],
      trustTier: 2,
      stats: { injected: 0, wins: 0, losses: 0 },
      createdAt: meta.createdAt ?? Date.now(),
    });
  }
  return entries;
}

async function readFlowSources(stateDir: string): Promise<Map<string, FlowSource>> {
  const result = new Map<string, FlowSource>();
  for (const file of await readdir(stateDir)) {
    if (!file.endsWith(".json")) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(join(stateDir, file), "utf8")) as unknown;
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) continue;
    const record = parsed as Record<string, unknown>;
    if (typeof record.flowId !== "string") continue;
    result.set(record.flowId, {
      flowId: record.flowId,
      ...(typeof record.requirement === "string" ? { requirement: record.requirement } : {}),
      ...(typeof record.logPath === "string" ? { logPath: record.logPath } : {}),
    });
  }
  return result;
}

async function readTail(path: string): Promise<string | undefined> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(path, "r");
    const { size } = await handle.stat();
    const length = Math.min(size, MAX_LOG_TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, Math.max(0, size - length));
    const text = buffer.subarray(0, bytesRead).toString("utf8").trim();
    return text === "" ? undefined : text;
  } catch {
    return undefined;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export async function distillFailureLessons(
  repoRoot: string,
  opts: DistillFailureLessonsOptions = {},
): Promise<DistillFailureLessonsResult> {
  const stateDir = opts.stateDir ?? resolveProjectStateDir(repoRoot);
  const now = opts.now ?? Date.now();
  const failures = await readRecentFailureItems(stateDir, opts.days ?? 7, now);
  const sources = await readFlowSources(stateDir);
  const runner = opts.runner ?? new CliRunner();
  let written = 0;
  let skipped = 0;

  for (const failure of failures) {
    const source = sources.get(failure.id);
    const trajectoryTail = source?.logPath ? await readTail(source.logPath) : undefined;
    if (!trajectoryTail) {
      skipped += 1;
      continue;
    }
    const signature = failureSignature(failure.reason);
    const goal = source?.requirement ?? failure.reason;
    let text: string;
    try {
      const result = await runner.run({
        stage: "design",
        system: "只从轨迹逐字证据蒸馏可复用教训；证据不足必须输出 NO_LESSON。",
        input: buildLessonPrompt({ goal, trajectoryTail, signature }),
        tools: [],
        cwd: repoRoot,
      });
      text = result.text;
    } catch {
      skipped += 1;
      continue;
    }
    const lessons = parseLessons(text, {
      goal,
      trajectoryTail,
      signature,
      sourceIds: [failure.id],
      ...(opts.projectId !== undefined ? { projectId: opts.projectId } : {}),
      createdAt: now,
      polarity: "failure",
      trustTier: 1,
    });
    if (lessons.length === 0) {
      skipped += 1;
      continue;
    }
    for (const lesson of lessons) {
      await appendLesson(stateDir, lesson);
      written += 1;
    }
  }

  return { attempted: failures.length, written, skipped };
}
