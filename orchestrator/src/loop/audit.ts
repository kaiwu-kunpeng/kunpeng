// 测试审计角色（开发循环的"测试审计"）：独立校验 spec 给出的验收命令是否"够强"，
// 堵住 spec 阶段自己吐弱测试的残留风险（C3 的最后一道）。
// 按 C8 做成确定性闸门——比让 LLM 当判官更可靠、更省 token。

import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

export interface AuditVerdict { strong: boolean; reason: string }
export interface AcceptanceAuditOptions {
  cwd?: string;
  authorFilePaths?: string[];
}

// 弱测试：只查存在/列目录/恒真，不校验内容（如 `test -f x`、`[ -f x ]`、`ls x`、`true`、`:`）。
const EXISTENCE_ONLY = /^(\[\s+-[efdsr]\b.*\]|test\s+-[efdsr]\b|ls(\s|$)|stat\s|true(\s|$)|:\s*$)/;
// 内容/断言级信号：出现其一即视为强测试（cmp/diff/grep/cat 比内容，==/-eq 比较，断言/测试框架）。
const CONTENT_SIGNAL = /[=!]=|-eq\b|\b(cmp|diff|grep|cat|assert|pytest|jest|vitest|go\s+test|node\s+--test)\b/;
const EXPLICIT_TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;
const TEST_RUNNER = /\b(?:npm|pnpm|yarn)\s+(?:run\s+)?test(?::[\w-]+)?\b|\b(?:cargo|go|dotnet|swift)\s+test\b|\b(?:mvn|gradle|make)\s+test\b|\b(?:pytest|rspec|phpunit|ctest)\b/;
const COMMAND_SEPARATORS = new Set(["&&", ";", "\n"]);

function tokenizeShellish(cmd: string): string[] {
  const tokens: string[] = [];
  let token = "";
  let quote: "'" | '"' | undefined;
  let escaped = false;
  for (let i = 0; i < cmd.length; i += 1) {
    const ch = cmd[i];
    if (escaped) {
      if (ch !== "\n" && ch !== "\r") token += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = undefined;
      else token += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      if (token) {
        tokens.push(token);
        token = "";
      }
      tokens.push("\n");
      continue;
    }
    if (/\s/.test(ch)) {
      if (token) {
        tokens.push(token);
        token = "";
      }
      continue;
    }
    if (ch === ";") {
      if (token) {
        tokens.push(token);
        token = "";
      }
      tokens.push(ch);
      continue;
    }
    if (ch === "&" && cmd[i + 1] === "&") {
      if (token) {
        tokens.push(token);
        token = "";
      }
      tokens.push("&&");
      i += 1;
      continue;
    }
    token += ch;
  }
  if (token) tokens.push(token);
  return tokens;
}

function isVitestToken(token: string): boolean {
  return token === "vitest" || token.endsWith("/vitest") || token === "vitest.mjs" || token.endsWith("/vitest.mjs");
}

function isExplicitTestPath(token: string): boolean {
  if (token.startsWith("-")) return false;
  if (token.includes("*") || token.includes("?") || token.includes("[")) return false;
  return EXPLICIT_TEST_FILE.test(token);
}

function existingFile(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

export function extractTestFiles(cmd: string): string[] {
  const tokens = tokenizeShellish(cmd);
  const files: string[] = [];
  const seen = new Set<string>();
  let segment: string[] = [];

  const checkSegment = () => {
    if (!segment.length) return;
    if (!segment.some(isVitestToken)) return;
    for (const token of segment) {
      if (!isExplicitTestPath(token) || seen.has(token)) continue;
      seen.add(token);
      files.push(token);
    }
  };

  for (const token of tokens) {
    if (COMMAND_SEPARATORS.has(token)) {
      checkSegment();
      segment = [];
    } else {
      segment.push(token);
    }
  }
  checkSegment();
  return files;
}

export function missingTestFiles(cmd: string, cwd = process.cwd(), authorFilePaths: string[] = []): string[] {
  const tokens = tokenizeShellish(cmd);
  const missing: string[] = [];
  const authorFiles = new Set(authorFilePaths.map((path) => resolve(cwd, path)));
  let dir = cwd;
  let segment: string[] = [];

  const checkSegment = () => {
    if (!segment.length) return;
    if (segment[0] === "cd" && segment[1]) {
      dir = resolve(dir, segment[1]);
      return;
    }
    if (!segment.some(isVitestToken)) return;
    for (const token of segment) {
      if (!isExplicitTestPath(token)) continue;
      const path = resolve(dir, token);
      if (!existingFile(path) && !authorFiles.has(path)) missing.push(token);
    }
  };

  for (const token of tokens) {
    if (COMMAND_SEPARATORS.has(token)) {
      checkSegment();
      segment = [];
    } else {
      segment.push(token);
    }
  }
  checkSegment();
  return missing;
}

/** 审计验收测试命令是否足以验证验收标准。无命令或仅存在性检查 = 弱（fail-closed）。 */
export function auditAcceptanceTest(cmd: string, options: AcceptanceAuditOptions = {}): AuditVerdict {
  const c = cmd.trim();
  if (!c) return { strong: false, reason: "spec 未给出验收验证命令" };
  if (EXISTENCE_ONLY.test(c) && !CONTENT_SIGNAL.test(c)) {
    return { strong: false, reason: "仅存在性/列目录/恒真检查，不校验内容（弱测试，违背 C3）" };
  }
  const missing = missingTestFiles(c, options.cwd ?? process.cwd(), options.authorFilePaths ?? []);
  if (missing.length) {
    return { strong: false, reason: `vitest 命令点名的测试文件不存在: ${missing.join(", ")}` };
  }
  const positive = CONTENT_SIGNAL.test(c)
    || EXPLICIT_TEST_FILE.test(c)
    || TEST_RUNNER.test(c)
    || /\bnode\s+-e\b/.test(c);
  if (!positive) {
    return { strong: false, reason: "未见内容/断言级校验信号，按 fail-closed 判弱测试（违背 C3）" };
  }
  return { strong: true, reason: "通过弱测试启发式（含内容/断言级校验或非平凡命令）" };
}
