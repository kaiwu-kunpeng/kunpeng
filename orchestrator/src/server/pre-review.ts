import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isRecord } from "../util/is-record.js";
import type { Artifact } from "../artifacts/types.js";
import type { AgentRunner } from "../agent/runner.js";
import { extractFirstJsonObject } from "../util/extract-json.js";

export type PreReviewVerdict = "approve" | "reject" | "review";

/** 一条预审发现：必须钉到 file:line 并带可核对证据（审计 K5）；缺任一项的发现在解析时直接丢弃。 */
export type PreReviewFinding = { file: string; line: number; issue: string; evidence: string };
/** normal=本次改动引入且须修；nit=可选打磨；pre_existing=main 原有、非本次引入。 */
export type PreReviewFindings = { normal: PreReviewFinding[]; nit: PreReviewFinding[]; pre_existing: PreReviewFinding[] };

export type PreReview = {
  verdict: PreReviewVerdict;
  reason: string;
  at: number;
  findings?: PreReviewFindings;
};

const MAX_REASON_LENGTH = 500;
const MAX_MERGE_DIFF_LENGTH = 30_000;
export const MERGE_DIFF_TRUNCATED_NOTICE = "diff 已被截断，你只看到了一部分；不得据此给出 approve。";
export const MERGE_CRITERIA_LABEL = "本次改动的验收标准：";
export const MERGE_PROJECT_RULES_LABEL = "本项目审查规则（REVIEW.md）：";
export const MERGE_FINDINGS_SCHEMA =
  'JSON schema: {"verdict":"approve|reject|review","reason":"简短理由","findings":{"normal":[{"file":"相对路径","line":新侧行号,"issue":"问题","evidence":"实跑输出或可核对的 diff 片段"}],"nit":[],"pre_existing":[]}}';
export const MERGE_FINDINGS_RULE =
  "每条 finding 必须同时带 file、line（diff 新侧行号）、issue、evidence 四项，缺任一项会被机器丢弃；normal=本次改动引入且必须修，nit=可选打磨，pre_existing=main 上原有非本次引入。有 normal 发现就不得 approve。";
const MAX_FINDINGS_PER_BUCKET = 20;
const MAX_FINDING_FIELD_LENGTH = 300;
const MAX_PROJECT_RULES_LENGTH = 4_000;

function normalizeFinding(value: unknown): PreReviewFinding | undefined {
  if (!isRecord(value)) return undefined;
  const file = typeof value.file === "string" ? value.file.trim() : "";
  const line = typeof value.line === "number" ? value.line : Number(value.line);
  const issue = typeof value.issue === "string" ? value.issue.trim() : "";
  const evidence = typeof value.evidence === "string" ? value.evidence.trim() : "";
  if (!file || !Number.isSafeInteger(line) || line <= 0 || !issue || !evidence) return undefined;
  return {
    file: file.slice(0, MAX_FINDING_FIELD_LENGTH),
    line,
    issue: issue.replace(/\s+/g, " ").slice(0, MAX_FINDING_FIELD_LENGTH),
    evidence: evidence.replace(/\s+/g, " ").slice(0, MAX_FINDING_FIELD_LENGTH),
  };
}

/** 把模型给的 findings 收成固定三桶；非数组/缺字段的条目全部丢弃（确定性门只吃带证据的发现）。 */
export function normalizeFindings(value: unknown): PreReviewFindings {
  const bucket = (key: string): PreReviewFinding[] => {
    const raw = isRecord(value) ? value[key] : undefined;
    if (!Array.isArray(raw)) return [];
    return raw.map(normalizeFinding).filter((item): item is PreReviewFinding => item !== undefined).slice(0, MAX_FINDINGS_PER_BUCKET);
  };
  return { normal: bucket("normal"), nit: bucket("nit"), pre_existing: bucket("pre_existing") };
}

/** 读托管项目根的 REVIEW.md 作本项目审查规则；缺失/空文件返回 undefined，读失败不抛。 */
export async function loadProjectReviewRules(repoRoot: string): Promise<string | undefined> {
  try {
    const text = (await readFile(join(repoRoot, "REVIEW.md"), "utf8")).trim();
    return text ? text.slice(0, MAX_PROJECT_RULES_LENGTH) : undefined;
  } catch {
    return undefined;
  }
}

export function extractAcceptanceCriteria(specBody: string, testCmd?: string): string {
  const lines = specBody.split(/\r?\n/);
  let start = lines.findIndex((line) => line.replace(/^[#*\s]+/, "").startsWith("验收"));
  if (start === -1) {
    start = lines.findIndex(
      (line) =>
        !/^#\s/.test(line) &&
        (/^#{1,6}\s/.test(line) || /^\*\*.+\*\*\s*$/.test(line)) &&
        line.includes("验收"),
    );
  }
  if (start === -1) {
    return testCmd ? `验收命令：\n${testCmd}` : "";
  }

  const collected = [lines[start]];
  for (let index = start + 1; index < lines.length; index++) {
    const line = lines[index];
    if (/^\s*```/.test(line) || /^#{1,6}\s/.test(line) || /^\*\*.+\*\*\s*$/.test(line)) break;
    collected.push(line);
  }
  return collected.join("\n").trim().slice(0, 4_000);
}

function fallback(reason: string, now: () => number): PreReview {
  return { verdict: "review", reason, at: now() };
}

function normalizeReason(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, MAX_REASON_LENGTH);
}

function normalizeVerdict(value: unknown): PreReviewVerdict {
  return value === "approve" || value === "reject" ? value : "review";
}

export async function preReviewProposal(
  artifact: Artifact,
  runner: AgentRunner,
  now: () => number = Date.now,
): Promise<PreReview> {
  let text: string;
  try {
    const result = await runner.run({
      stage: "review",
      tools: [],
      system: [
        "你是鲲鹏自我进化提案的机器预审员。",
        "只输出一个 JSON 对象，不要 Markdown，不要解释，不要代码围栏。",
        'JSON schema: {"verdict":"approve|reject|review","reason":"简短理由"}',
        "approve/reject 只能用于非常明确的低风险结论；不确定、信息不足、理由为空时输出 review。",
      ].join("\n"),
      input: [
        `artifact kind: ${artifact.kind}`,
        `artifact id: ${artifact.id}`,
        `artifact status: ${artifact.status}`,
        "artifact meta:",
        JSON.stringify(artifact.meta ?? {}, null, 2),
        "artifact body:",
        artifact.body,
      ].join("\n\n"),
    });
    text = result.text;
  } catch (e) {
    return fallback(`预审 runner 调用失败：${e instanceof Error ? e.message : String(e)}`, now);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractFirstJsonObject(text));
  } catch (e) {
    return fallback(`预审 JSON 解析失败：${e instanceof Error ? e.message : String(e)}`, now);
  }

  if (!isRecord(parsed)) return fallback("预审输出不是 JSON 对象，转人工复核。", now);

  const reason = normalizeReason(parsed.reason);
  if (!reason) return fallback("预审未给出有效理由，转人工复核。", now);

  return {
    verdict: normalizeVerdict(parsed.verdict),
    reason,
    at: now(),
  };
}

export async function preReviewMerge(
  diff: string,
  runner: AgentRunner,
  now: () => number = Date.now,
  criteria?: string,
  projectRules?: string,
): Promise<PreReview> {
  const truncated = diff.length > MAX_MERGE_DIFF_LENGTH;
  let text: string;
  try {
    const result = await runner.run({
      stage: "review",
      tools: [],
      system: [
        "你是鲲鹏合并门机器预审员，判断这段 diff 是否可安全合并到 main。",
        "只输出一个 JSON 对象，不要 Markdown，不要解释，不要代码围栏。",
        MERGE_FINDINGS_SCHEMA,
        MERGE_FINDINGS_RULE,
        "不确定、风险大、信息不足或理由为空时输出 review。",
        ...(truncated ? [MERGE_DIFF_TRUNCATED_NOTICE] : []),
        ...(criteria ? [MERGE_CRITERIA_LABEL, criteria] : []),
        ...(projectRules ? [MERGE_PROJECT_RULES_LABEL, projectRules] : []),
      ].join("\n"),
      input: diff.slice(0, MAX_MERGE_DIFF_LENGTH),
    });
    text = result.text;
  } catch (e) {
    return fallback(`预审 runner 调用失败：${e instanceof Error ? e.message : String(e)}`, now);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractFirstJsonObject(text));
  } catch (e) {
    return fallback(`预审 JSON 解析失败：${e instanceof Error ? e.message : String(e)}`, now);
  }

  if (!isRecord(parsed)) return fallback("预审输出不是 JSON 对象，转人工复核。", now);

  const reason = normalizeReason(parsed.reason);
  if (!reason) return fallback("预审未给出有效理由，转人工复核。", now);

  const findings = normalizeFindings(parsed.findings);
  let verdict = normalizeVerdict(parsed.verdict);
  let finalReason = reason;
  if (verdict === "approve" && findings.normal.length > 0) {
    verdict = "review";
    finalReason = normalizeReason(`approve 与 ${findings.normal.length} 条 normal 发现矛盾，已降级为 review：${reason}`);
  }
  if (truncated && verdict === "approve") {
    return {
      verdict: "review",
      reason: normalizeReason(`diff 已截断，approve 已降级为 review：${reason}`),
      at: now(),
      findings,
    };
  }

  return {
    verdict,
    reason: finalReason,
    at: now(),
    findings,
  };
}
