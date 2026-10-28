import { posix } from "node:path";
import { detectScopeDrift } from "./scope-gate.js";

export const EVAL_TAMPER_KIND = "eval-tamper";
export const EVAL_TAMPER_PREFIX = "评测资产守卫";
export const ACCEPT_REF_LABEL = "验收命令引用文件";

export interface EvalAssetRule { label: string; pattern: RegExp }
export interface EvalAssetViolation { file: string; label: string }
export interface EvalAssetGuardInput {
  changedFiles: readonly string[];
  allowGlobs?: readonly string[];
  exemptPaths?: readonly string[];
  acceptanceCmd?: string;
}

export const EVAL_ASSET_RULES: readonly EvalAssetRule[] = [
  { label: "测试目录", pattern: /^orchestrator\/test\// },
  { label: "测试配置", pattern: /^(?:orchestrator\/)?(?:vitest|jest)\.config\.[cm]?[jt]s$/ },
  { label: "回归库", pattern: /(^|\/)\.kunpeng\/regression\// },
  { label: "适应度基线", pattern: /(^|\/)\.kunpeng\/state\/fitness-baseline\.json$/ },
  { label: "评测代码", pattern: /^(?:orchestrator\/)?src\/evolution\/(?:eval-[^/]+|fitness[^/]*|regression-store)\.ts$/ },
  { label: "验证门源码", pattern: /^(?:orchestrator\/)?src\/verify\// },
  { label: "验收审计源码", pattern: /^(?:orchestrator\/)?src\/loop\/(?:audit|scope-audit|rollback-attribution)\.ts$/ },
];

export function evalAssetRefsFromAcceptance(cmd: string): string[] {
  const refs = new Set<string>();
  let cwd = ".";
  for (const segment of cmd.split(/&&|\|\||[;|\n]/)) {
    const tokens = segment.trim().split(/\s+/).map((token) => token.replace(/^["']+|["']+$/g, ""));
    if (tokens[0] === "cd") {
      const dir = tokens[1];
      if (dir && dir !== "-" && !posix.isAbsolute(dir)) cwd = posix.join(cwd, dir);
      continue;
    }
    for (const token of tokens) {
      if (token.startsWith("-") || token.startsWith("/") || /[*?[]/.test(token)) continue;
      if (!/\.(?:[cm]?[jt]sx?|sh|bash|zsh|py|rb|go|rs)$/.test(token)) continue;
      const file = posix.normalize(posix.join(cwd, token)).replace(/^\.\//, "");
      if (!file.startsWith("..")) refs.add(file);
    }
  }
  return [...refs];
}

function normalizePath(path: string): string {
  const file = path.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  return file ? posix.normalize(file) : "";
}

export function findEvalAssetViolations(input: EvalAssetGuardInput): EvalAssetViolation[] {
  const exempt = new Set((input.exemptPaths ?? []).map(normalizePath));
  const allow = (input.allowGlobs ?? []).map((glob) => glob.trim()).filter(Boolean);
  const refs = evalAssetRefsFromAcceptance(input.acceptanceCmd ?? "");
  const seen = new Set<string>();
  const violations: EvalAssetViolation[] = [];
  for (const path of input.changedFiles) {
    const file = normalizePath(path);
    if (!file || seen.has(file)) continue;
    seen.add(file);
    if (exempt.has(file)) continue;
    const label = EVAL_ASSET_RULES.find((rule) => rule.pattern.test(file))?.label
      ?? (refs.some((ref) => file === ref || file.endsWith("/" + ref)) ? ACCEPT_REF_LABEL : undefined);
    if (!label) continue;
    if (allow.length && detectScopeDrift([file], { allow, forbid: [] }).ok === true) continue;
    violations.push({ file, label });
  }
  return violations;
}

export function formatEvalTamperMessage(violations: readonly EvalAssetViolation[]): string {
  return `${EVAL_TAMPER_PREFIX}：改动触碰评测资产且未被 scope allow 显式放行：${violations.map(({ file, label }) => `${file}（${label}）`).join(", ")}`;
}
