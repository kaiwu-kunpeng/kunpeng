import { existsSync } from "node:fs";
import { join } from "node:path";
import { formatObserveWarn, gateModeFor, recordGateObservation } from "./gate-mode.js";

export interface PreReviewFindingLike { file: string; line: number; issue: string; evidence: string }
export interface PreReviewFindingsLike { normal?: PreReviewFindingLike[]; nit?: PreReviewFindingLike[]; pre_existing?: PreReviewFindingLike[] }

export interface MergeReviewContext {
  repoRoot: string;
  flowId: string;
  base: string;
  diff: string;
  /** 该流人工门上已落盘的 LLM 预审（含带证据的发现）；normal 桶进确定性拦截，nit/pre_existing 只随 details 带出（审计 P1-6）。 */
  preReview?: { verdict: string; reason: string; findings?: PreReviewFindingsLike };
}

export interface MergeReviewFinding {
  severity: "error" | "warn" | "info";
  file: string;
  issue: string;
  evidence: string;
  suggestion: string;
}

export interface MergeReviewResult {
  block: boolean;
  findings: string[];
  details: MergeReviewFinding[];
  observed?: boolean;
}

export interface MergeReviewOptions {
  env?: NodeJS.ProcessEnv;
  warn?: (message: string) => void;
}

export const MERGE_REVIEW_GATE = "merge-review";
export const PROTECTED_FILE_ISSUE = "改动触及宪法/角色卡/AGENTS/技能规则，属于人工门 #2 范围";
export const BINARY_PATCH_ISSUE = "二进制补丁无法用文本审查证明安全";
export const OBSERVABLE_ISSUES = new Set([PROTECTED_FILE_ISSUE, BINARY_PATCH_ISSUE]);
export const PRE_REVIEW_NORMAL_ISSUE_PREFIX = "预审 normal 发现：";

export function isObservableMergeFinding(item: MergeReviewFinding): boolean {
  return item.severity === "error" && (OBSERVABLE_ISSUES.has(item.issue) || item.issue.startsWith(PRE_REVIEW_NORMAL_ISSUE_PREFIX));
}

function isEvidencedFinding(item: PreReviewFindingLike | undefined): item is PreReviewFindingLike {
  return !!item && typeof item.file === "string" && item.file.trim() !== "" && Number.isSafeInteger(item.line) && item.line > 0
    && typeof item.issue === "string" && item.issue.trim() !== "" && typeof item.evidence === "string" && item.evidence.trim() !== "";
}

const PRE_REVIEW_BUCKETS = [
  { key: "normal", severity: "error", suggestion: "修复后重跑该流；或人工复核该发现后手动合并。" },
  { key: "nit", severity: "warn", suggestion: "可选打磨，不拦合并。" },
  { key: "pre_existing", severity: "info", suggestion: "main 上原有问题，另开流处理。" },
] as const;

/** 把预审三桶发现转成审查条目：只认带 file:line+证据的条目；normal→error（拦），nit→warn，pre_existing→info。 */
export function preReviewFindingsToDetails(preReview: MergeReviewContext["preReview"]): MergeReviewFinding[] {
  const out: MergeReviewFinding[] = [];
  for (const bucket of PRE_REVIEW_BUCKETS) {
    for (const item of preReview?.findings?.[bucket.key] ?? []) {
      if (!isEvidencedFinding(item)) continue;
      const issue = bucket.key === "normal" ? `${PRE_REVIEW_NORMAL_ISSUE_PREFIX}${item.issue}` : `预审 ${bucket.key} 发现：${item.issue}`;
      out.push(finding(bucket.severity, `${item.file}:${item.line}`, issue, item.evidence, bucket.suggestion));
    }
  }
  return out;
}

interface DiffFile {
  path: string;
  oldPath: string;
  added: string[];
  removed: string[];
  rawHeaders: string[];
  rawLines: string[];
}

const protectedFilePatterns: RegExp[] = [
  /^AGENTS\.md$/,
  /^constitution\/.+\.md$/,
  /^roster\/[^/]+\.role\.md$/,
  /^skills\/[^/]+\/SKILL\.md$/,
];

const secretPatterns: Array<{ name: string; pattern: RegExp }> = [
  { name: "private key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/ },
  { name: "OpenAI API key", pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { name: "AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "generic secret assignment", pattern: /\b(api[_-]?key|secret|token|password)\b\s*[:=]\s*["'][^"']{12,}["']/i },
];

function normalizePath(path: string): string {
  if (path === "/dev/null") return path;
  return path.replace(/^a\//, "").replace(/^b\//, "");
}

function pathFromDiffHeader(line: string): string {
  const match = /^diff --git (.+) (.+)$/.exec(line);
  if (!match) return "(unknown)";
  return normalizePath(match[2]);
}

function oldPathFromDiffHeader(line: string): string {
  const match = /^diff --git (.+) (.+)$/.exec(line);
  if (!match) return "(unknown)";
  return normalizePath(match[1]);
}

function parseDiff(diff: string): DiffFile[] {
  const files: DiffFile[] = [];
  let current: DiffFile | undefined;
  let inHunk = false;

  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) {
      current = {
        path: pathFromDiffHeader(line),
        oldPath: oldPathFromDiffHeader(line),
        added: [],
        removed: [],
        rawHeaders: [line],
        rawLines: [line],
      };
      files.push(current);
      inHunk = false;
      continue;
    }
    if (!current) continue;
    current.rawLines.push(line);
    if (line.startsWith("@@")) {
      inHunk = true;
      continue;
    }
    if (
      !inHunk &&
      (line.startsWith("+++ ") ||
        line.startsWith("--- ") ||
        line.startsWith("index ") ||
        line.startsWith("new file mode ") ||
        line.startsWith("deleted file mode "))
    ) {
      current.rawHeaders.push(line);
      if (line.startsWith("+++ ")) {
        const nextPath = normalizePath(line.slice(4).trim());
        if (nextPath !== "/dev/null") current.path = nextPath;
      }
      if (line.startsWith("--- ")) {
        const oldPath = normalizePath(line.slice(4).trim());
        if (oldPath !== "/dev/null") current.oldPath = oldPath;
      }
      continue;
    }
    if (line.startsWith("+")) {
      current.added.push(line.slice(1));
    } else if (line.startsWith("-")) {
      current.removed.push(line.slice(1));
    }
  }

  return files;
}

/** 测试文件豁免低精度规则:单测里的假口令(password: "long-enough-1")天然命中 generic 规则,
 *  曾把 users 服务层的合并整个卡死(全部误报)。高精度规则(私钥/gh_/sk-/AKIA)不豁免——真密钥测试里也不该有。 */
const LOW_PRECISION_RULES = new Set(["generic secret assignment"]);

function isTestPath(path: string): boolean {
  return /\.(test|spec)\.[a-z]+$/i.test(path) || /(^|\/)__tests__\//.test(path) || /(^|\/)tests?\//.test(path);
}

function firstMatchingSecret(line: string, testFile = false): string | undefined {
  return secretPatterns.find(
    (entry) => !(testFile && LOW_PRECISION_RULES.has(entry.name)) && entry.pattern.test(line),
  )?.name;
}

function isProtectedPath(path: string): boolean {
  return protectedFilePatterns.some((pattern) => pattern.test(path));
}

function redactedEvidence(line: string): string {
  if (line.length <= 96) return line;
  return `${line.slice(0, 93)}...`;
}

function finding(
  severity: MergeReviewFinding["severity"],
  file: string,
  issue: string,
  evidence: string,
  suggestion: string,
): MergeReviewFinding {
  return { severity, file, issue, evidence, suggestion };
}

function isConflictMarkerLine(content: string): boolean {
  return /^(?:<{7}(?: |$)|={7}$|>{7}(?: |$))/.test(content);
}

export function reviewMergeDiff(ctx: MergeReviewContext): MergeReviewResult {
  const details: MergeReviewFinding[] = [];
  const diff = ctx.diff.trimEnd();

  if (!ctx.flowId.trim()) {
    details.push(finding("error", "(merge)", "flowId 为空", "flowId was blank", "传入明确的 flowId 后再合并。"));
  }
  if (!ctx.base.trim()) {
    details.push(finding("error", "(merge)", "base 为空", "base was blank", "传入明确的目标分支后再合并。"));
  }
  if (!diff.trim()) {
    details.push(
      finding("error", "(diff)", "待合并 diff 为空", "git diff returned no content", "确认 kp/<flowId> 相对目标分支确有可审查改动。"),
    );
  }

  const files = parseDiff(diff);
  if (diff.trim() !== "" && files.length === 0) {
    details.push(
      finding(
        "error",
        "(diff)",
        "无法解析出任何文件（缺少 diff --git 头）",
        "parseDiff returned no files for a non-empty diff",
        "改用标准 `git diff <base>...<branch>` 产出的 diff；解析不出即判失败，绝不放行。",
      ),
    );
  }
  for (const file of files) {
    const changedLines = [...file.added, ...file.removed];
    const touchedProtectedFile = isProtectedPath(file.path) || isProtectedPath(file.oldPath);
    if (touchedProtectedFile) {
      details.push(
        finding(
          "error",
          isProtectedPath(file.path) ? file.path : file.oldPath,
          PROTECTED_FILE_ISSUE,
          file.rawHeaders[0] ?? file.path,
          "停止自动合并，改为产出提案并交人工确认。",
        ),
      );
    }

    if (file.rawLines.some((line) => line.includes("GIT binary patch") || line.startsWith("Binary files "))) {
      details.push(
        finding(
          "error",
          file.path,
          BINARY_PATCH_ISSUE,
          "GIT binary patch",
          "把二进制产物移出本次自动合并，或补充可复现生成与人工审查证据。",
        ),
      );
    }

    for (const line of changedLines) {
      if (isConflictMarkerLine(line)) {
        details.push(finding("error", file.path, "diff 中残留冲突标记", redactedEvidence(line), "先解决冲突标记并重新验证。"));
      }
    }

    for (const line of file.added) {
      const secret = firstMatchingSecret(line, isTestPath(file.path));
      if (secret) {
        details.push(
          finding("error", file.path, `新增内容疑似包含 ${secret}`, redactedEvidence(line), "移除密钥/凭据，改用环境变量或本地登录态。"),
        );
      }
    }
  }

  details.push(...preReviewFindingsToDetails(ctx.preReview));

  const summaries = details.filter((item) => item.severity === "error").map((item) => `${item.file}: ${item.issue} (${item.evidence})`);

  return {
    block: summaries.length > 0,
    findings: summaries,
    details,
  };
}

function ledgerRoot(repoRoot: string): string | undefined {
  return existsSync(join(repoRoot, ".git")) ? repoRoot : undefined;
}

export async function reviewMerge(ctx: MergeReviewContext, opts: MergeReviewOptions = {}): Promise<MergeReviewResult> {
  const result = reviewMergeDiff(ctx);
  if (!result.block) return result;

  const warn = opts.warn ?? ((message: string) => console.warn(message));
  const mode = gateModeFor(MERGE_REVIEW_GATE, ctx.repoRoot, opts.env, warn);
  const errors = result.details.filter((item) => item.severity === "error");
  const reason = errors.map((item) => `${item.file}: ${item.issue}`).join(", ");
  recordGateObservation(ledgerRoot(ctx.repoRoot), {
    gate: MERGE_REVIEW_GATE,
    flowId: ctx.flowId,
    wouldBlock: true,
    reason,
    at: Date.now(),
    mode,
  }, warn);

  if (mode === "observe") {
    if (errors.every(isObservableMergeFinding)) {
      warn(formatObserveWarn(MERGE_REVIEW_GATE, reason));
      return { ...result, block: false, observed: true };
    }
    warn(`[gate:${MERGE_REVIEW_GATE}] observe 模式：命中硬底线，仍拦截 → ${reason}`);
  }
  return result;
}

export const defaultMergeReview = reviewMerge;
