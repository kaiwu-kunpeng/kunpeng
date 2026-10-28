import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import ts from "typescript";
import { extractAuthorFilesFromSpec } from "../loop/dev-cycle.js";
import { auditAcceptanceTest } from "../loop/audit.js";
import { loadRecurrenceRules } from "../metrics/rollback-recurrence.js";
import { detectScopeDrift, parseScopeDeclaration, type ScopeDecl } from "../verify/scope-gate.js";
import { judgeAssertions, parseAcceptAssertions } from "./accept-assertions.js";
import { extractAcceptance } from "./acceptance.js";
import { parseMethodPlan } from "./parse.js";
import { describeSpecRisk } from "./decide.js";

export interface SpecLintIssue {
  level: "error" | "warn" | "info";
  code: string;
  message: string;
}

interface FenceBlock {
  info: string;
  content: string;
}

function markdownFenceLines(specText: string): string[] {
  return specText.split(/\r?\n/).filter((line) => /^[ \t]*```/.test(line));
}

function fencedBlocks(specText: string): FenceBlock[] {
  const blocks: FenceBlock[] = [];
  const lines = specText.split(/\r?\n/);
  let open: { info: string; content: string[] } | undefined;

  for (const line of lines) {
    const fence = /^[ \t]*```(.*)$/.exec(line);
    if (!fence) {
      open?.content.push(line);
      continue;
    }

    if (open) {
      blocks.push({ info: open.info, content: open.content.join("\n") });
      open = undefined;
      continue;
    }

    open = { info: (fence[1] ?? "").trim(), content: [] };
  }

  if (open) blocks.push({ info: open.info, content: open.content.join("\n") });
  return blocks;
}

function isFenceKind(info: string, kind: string): boolean {
  return info === kind || info.startsWith(`${kind} `) || info.startsWith(`${kind}\t`);
}

function issue(level: SpecLintIssue["level"], code: string, message: string): SpecLintIssue {
  return { level, code, message };
}

function candidateBases(cmd: string, cwd: string): string[] {
  const bases = [cwd];
  let current = cwd;
  for (const match of cmd.matchAll(/(?:^|[\s;&|])cd\s+([^\s;&|]+)/g)) {
    const target = match[1];
    if (target === "-" || isAbsolute(target)) continue;
    current = resolve(current, target);
    bases.push(current);
  }
  return bases;
}

function assertionHolds(
  cmd: string,
  cwd: string,
): (assertion: { pattern: string; file: string }) => boolean {
  const bases = candidateBases(cmd, cwd);
  return (assertion) => {
    for (const base of bases) {
      const path = resolve(base, assertion.file);
      if (!existsSync(path) || !statSync(path).isFile()) continue;
      const text = readFileSync(path, "utf8");
      try {
        return new RegExp(assertion.pattern).test(text);
      } catch {
        return text.includes(assertion.pattern);
      }
    }
    return false;
  };
}

const TEST_FILE_ARG = /(?:^|\s)((?:\.\/)?[\w./@-]+\.(?:test|spec)\.[cm]?[jt]sx?)(?=$|[\s;&|)])/g;
const EXISTENCE_ARG = /(?:^|[\s;&|(])test\s+-[fe]\s+([^\s;&|)]+)/g;

/** accept 里 vitest 点名的测试文件（只看含 vitest 的命令段）。 */
export function vitestNamedFiles(cmd: string): string[] {
  const out: string[] = [];
  for (const segment of cmd.split(/&&|\|\||;/)) {
    if (!/\bvitest\b/.test(segment)) continue;
    for (const match of segment.matchAll(TEST_FILE_ARG)) out.push(match[1]);
  }
  return out;
}

/** accept 里 test -f / test -e 断言存在的路径。 */
export function existenceAnchors(cmd: string): string[] {
  return [...cmd.matchAll(EXISTENCE_ARG)].map((match) => match[1]);
}

/** 非末尾的独立命令行；续行链内的行属于同一条命令。 */
export function acceptNonFinalLines(cmd: string): string[] {
  const lines = cmd.split(/\r?\n/).map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
  const continues = (line: string): boolean => /(?:\\|&&|\|\||\|)$/.test(line);
  return lines.slice(0, -1).filter((line, index) =>
    !continues(line) && (index === 0 || !continues(lines[index - 1])),
  );
}

/** 精确点名的源文件，其既有测试消费方也需要纳入本流范围。 */
export function scopeTestConsumers(
  allow: readonly string[], cwd: string, scope: ScopeDecl,
): { file: string; tests: string[] }[] {
  const files = allow.filter((entry) =>
    !/[*?[]/.test(entry) && /^orchestrator\/src\/.+\.ts$/.test(entry) && existsSync(join(cwd, entry)),
  );
  const testRoot = join(cwd, "orchestrator/test");
  if (files.length === 0 || !existsSync(testRoot)) return [];

  const consumers: { file: string; content: string }[] = [];
  function scan(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        scan(path);
      } else if (entry.isFile() && entry.name.endsWith(".ts")) {
        const file = relative(cwd, path);
        if (!detectScopeDrift([file], scope).ok) {
          consumers.push({ file, content: readFileSync(path, "utf8") });
        }
      }
    }
  }
  scan(testRoot);

  return files.map((file) => {
    const base = basename(file, ".ts").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp("/" + base + "\\.js[\"']");
    const tests = consumers.filter((test) => pattern.test(test.content)).map((test) => test.file).sort();
    return { file, tests };
  }).filter((result) => result.tests.length > 0);
}

type PathVerdict = "exists" | "author" | "in-scope" | "missing";

function classifyAcceptPath(
  arg: string, cmd: string, cwd: string, authorAbs: Set<string>, scope: ReturnType<typeof parseScopeDeclaration>,
): PathVerdict {
  const candidates = candidateBases(cmd, cwd).map((base) => resolve(base, arg));
  if (candidates.some((path) => existsSync(path))) return "exists";
  if (candidates.some((path) => authorAbs.has(path))) return "author";
  if (scope && candidates.some((path) => detectScopeDrift([relative(cwd, path)], scope).violations.length === 0)) return "in-scope";
  return "missing";
}

function syntaxProblem(path: string, content: string): string | undefined {
  if (!/\.[cm]?[jt]sx?$/.test(path)) return undefined;
  const out = ts.transpileModule(content, {
    fileName: path,
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  });
  const first = out.diagnostics?.[0];
  return first ? ts.flattenDiagnosticMessageText(first.messageText, "\n") : undefined;
}

export function lintSpecText(specText: string, cwd: string = process.cwd()): SpecLintIssue[] {
  const issues: SpecLintIssue[] = [];
  const fenceLines = markdownFenceLines(specText);
  const blocks = fencedBlocks(specText);
  const authorFilePaths = extractAuthorFilesFromSpec(specText).map((file) => file.path);

  if (fenceLines.length % 2 !== 0) {
    issues.push(issue("error", "fence-unterminated", "Markdown ``` 围栏数量为奇数，存在未闭合围栏"));
  }

  const scopeBlocks = blocks.filter((block) => isFenceKind(block.info, "scope"));
  const hasScopeOpening = fenceLines.some((line) => /^[ \t]*```scope(?:[ \t]|$)/.test(line));
  const scope = parseScopeDeclaration(specText);
  if (!hasScopeOpening) {
    issues.push(issue("error", "scope-missing", "spec 未声明 ```scope 范围块"));
  } else if (!scope || scope.allow.length === 0) {
    issues.push(issue("error", "scope-empty", "scope 已声明，但解析后的 allow 为空"));
  }

  for (const block of scopeBlocks) {
    for (const [index, rawLine] of block.content.split(/\r?\n/).entries()) {
      const line = rawLine.trim();
      if (line === "") continue;
      if (!/^(?:allow|forbid):[ \t]+\S.*$/.test(line)) {
        issues.push(issue(
          "error",
          "scope-line-invalid",
          `scope 第 ${index + 1} 行不是单行 allow: <glob> 或 forbid: <glob>：${line}`,
        ));
      }
    }
  }

  if (scope && !scope.malformed) {
    for (const consumer of scopeTestConsumers(scope.allow, cwd, scope)) {
      issues.push(issue(
        "warn",
        "scope-test-consumers",
        `源文件「${consumer.file}」的既有测试消费方不在 scope 内：${consumer.tests.slice(0, 5).join("、")}`,
      ));
    }
  }

  const plan = parseMethodPlan(specText);
  const flows = plan.phases.flatMap((phase) => phase.flows);
  for (const flow of flows) {
    const acceptanceCmd = flow.acceptanceCmd ?? extractAcceptance(flow.requirement);
    if (!acceptanceCmd?.trim()) {
      issues.push(issue("error", "accept-missing", `flow「${flow.title}」缺少非空 acceptanceCmd`));
      continue;
    }
    const nonFinalLines = acceptNonFinalLines(acceptanceCmd);
    if (nonFinalLines.length > 0) {
      issues.push(issue(
        "warn",
        "accept-nonfinal-line",
        `flow「${flow.title}」验收块非末尾的独立命令行失败可能被忽略：${nonFinalLines.join("；")}`,
      ));
    }
    const audit = auditAcceptanceTest(acceptanceCmd, { cwd, authorFilePaths });
    if (!audit.strong) {
      issues.push(issue("error", "accept-weak", `flow「${flow.title}」验收命令过弱：${audit.reason}`));
    }
    const positives = parseAcceptAssertions(acceptanceCmd).filter((assertion) => !assertion.negated);
    for (const verdict of judgeAssertions(positives, assertionHolds(acceptanceCmd, cwd))) {
      if (!verdict.vacuous) continue;
      issues.push(issue(
        "warn",
        "accept-assertion-vacuous",
        `flow「${flow.title}」验收断言空转：模式「${verdict.pattern}」已存在于文件「${verdict.file}」`,
      ));
    }
  }

  if (scope && authorFilePaths.length > 0) {
    for (const violation of detectScopeDrift(authorFilePaths, scope).violations) {
      issues.push(issue(
        "error",
        "accept-file-outside-scope",
        `验收件「${violation.file}」越界(${violation.rule})：实现者无权创建/改写它，范围门会拦截整条流`,
      ));
    }
  }
  const authorFiles = extractAuthorFilesFromSpec(specText);
  const authorAbs = new Set(authorFiles.map((file) => resolve(cwd, file.path)));
  for (const flow of flows) {
    const acceptanceCmd = flow.acceptanceCmd ?? extractAcceptance(flow.requirement);
    if (!acceptanceCmd?.trim()) continue;
    for (const file of vitestNamedFiles(acceptanceCmd)) {
      const verdict = classifyAcceptPath(file, acceptanceCmd, cwd, authorAbs, scope);
      if (verdict === "missing") {
        issues.push(issue("error", "accept-test-missing", `flow「${flow.title}」验收点名的测试文件「${file}」既不在盘上、也不是 accept-file、也不在 scope allow 内`));
      } else if (verdict === "in-scope") {
        issues.push(issue("warn", "accept-test-unlocked", `flow「${flow.title}」验收点名的测试文件「${file}」尚不存在且未用 accept-file 锁定，实现者可自写弱测试凑绿`));
      }
    }
    for (const anchor of existenceAnchors(acceptanceCmd)) {
      if (classifyAcceptPath(anchor, acceptanceCmd, cwd, authorAbs, scope) === "missing") {
        issues.push(issue("error", "accept-anchor-missing", `flow「${flow.title}」验收用 test 断言的「${anchor}」不存在，也不会由本流创建（不在 accept-file / scope allow 内）`));
      }
    }
    if (/\bvitest\b/.test(acceptanceCmd) && !/env\s+-u\s+KUNPENG_BACKEND\b/.test(acceptanceCmd)) {
      issues.push(issue("warn", "accept-vitest-backend-env", `flow「${flow.title}」验收跑 vitest 但没有 env -u KUNPENG_BACKEND，worktree 注入的后端变量会让部分测试假红`));
    }
  }
  for (const file of authorFiles) {
    const problem = syntaxProblem(file.path, file.content);
    if (problem) {
      issues.push(issue("error", "accept-file-syntax", `验收件「${file.path}」有语法错误：${problem}`));
    }
  }
  if (flows.length > 4) {
    issues.push(issue("warn", "flows-many", `spec 解析出 ${flows.length} 个 flow，超过建议上限 4`));
  }

  for (const block of blocks.filter((candidate) => isFenceKind(candidate.info, "accept-file"))) {
    const hasPath = /(?:^|[ \t])path=(?:"[^"]+"|'[^']+'|[^\s]+)/.test(block.info);
    if (!hasPath) {
      issues.push(issue("error", "accept-file-no-path", "accept-file 围栏缺少 path= 属性"));
    }

    const normalizedFence = `\`\`\`${block.info}\n${block.content}\n\`\`\``;
    const content = extractAuthorFilesFromSpec(normalizedFence)[0]?.content ?? block.content;
    if (!content.includes("test -f") && !content.includes("expect(")) {
      issues.push(issue("warn", "accept-file-weak", "accept-file 内容既不含 test -f，也不含 expect("));
    }
  }

  const acceptFileBodies = blocks
    .filter((candidate) => isFenceKind(candidate.info, "accept-file"))
    .map((block) => {
      const normalizedFence = `\`\`\`${block.info}\n${block.content}\n\`\`\``;
      return extractAuthorFilesFromSpec(normalizedFence)[0]?.content ?? block.content;
    })
    .join("\n");
  const positiveLiterals = new Set<string>();
  const negativeLiterals = new Set<string>();
  for (const match of acceptFileBodies.matchAll(/(?<!\.not)\.toContain\((["'])(.*?)\1\)/g)) {
    if (match[2].length >= 3) positiveLiterals.add(match[2]);
  }
  for (const match of acceptFileBodies.matchAll(/\.not\.toContain\((["'])(.*?)\1\)/g)) {
    if (match[2].length >= 3) negativeLiterals.add(match[2]);
  }
  let contradictionReported = false;
  for (const positive of positiveLiterals) {
    if (contradictionReported) break;
    for (const negative of negativeLiterals) {
      if (negative !== positive && positive.includes(negative)) {
        issues.push(issue(
          "warn",
          "accept-contradiction-substring",
          `验收件里负断言 .not.toContain("${negative}") 是正断言 .toContain("${positive}") 的子串，正负断言互相矛盾`,
        ));
        contradictionReported = true;
        break;
      }
    }
  }

  // 派流前回滚风险提示：只推动 L0–L1，info 级，绝不拦派（C5/C8）。
  issues.push(issue("info", "spec-rollback-risk", describeSpecRisk(specText)));

  for (const rule of loadRecurrenceRules(join(cwd, ".kunpeng"))) {
    issues.push(issue("info", rule.code, `近期 ${rule.count} 条流因 ${rule.kind} 回滚（样本：${rule.sample.slice(0, 80)}）；${rule.hint}`));
  }
  return issues;
}

export function formatLintReport(issues: SpecLintIssue[]): string {
  if (issues.length === 0) return "✅ spec 校验通过";

  const errors = issues.filter((item) => item.level === "error");
  const warnings = issues.filter((item) => item.level === "warn");
  const infos = issues.filter((item) => item.level === "info");
  const lines: string[] = [];
  if (errors.length > 0) {
    lines.push(`❌ 错误 (${errors.length})`);
    lines.push(...errors.map((item) => `  - [${item.code}] ${item.message}`));
  }
  if (warnings.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push(`⚠️ 告警 (${warnings.length})`);
    lines.push(...warnings.map((item) => `  - [${item.code}] ${item.message}`));
  }
  if (infos.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push(`ℹ️ 提示 (${infos.length})`);
    lines.push(...infos.map((item) => `  - [${item.code}] ${item.message}`));
  }
  return lines.join("\n");
}
