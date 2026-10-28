import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  OPERATION_CATEGORIES, parsePolicyMatrix, resolveActionPolicy, type PolicyMatrix, type ResolvedPolicy,
} from "./requirements.js";

/** 人写的底线，loop / spec 不可覆盖（只能比内建更严）。 */
export const REQUIREMENTS_FILE = ".kunpeng/policy/requirements.json";
/** 人写的缺省，spec 可覆盖。 */
export const DEFAULTS_FILE = ".kunpeng/policy/defaults.json";

export interface LoadedActionPolicy extends ResolvedPolicy { files: { requirements?: string; defaults?: string } }

function readPolicyFile(repoRoot: string, relative: string): Partial<PolicyMatrix> | undefined {
  const path = join(repoRoot, relative);
  if (!existsSync(path)) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${relative} 不是合法 JSON：${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  return parsePolicyMatrix(raw, relative);
}

/** 文件缺失使用内建；人写配置错误直接抛错，不静默回退。 */
export function loadActionPolicy(repoRoot: string, spec?: Partial<PolicyMatrix>): LoadedActionPolicy {
  const requirements = readPolicyFile(repoRoot, REQUIREMENTS_FILE);
  const defaults = readPolicyFile(repoRoot, DEFAULTS_FILE);
  const resolved = resolveActionPolicy({ requirements, defaults, spec });
  return {
    ...resolved,
    files: {
      ...(requirements !== undefined ? { requirements: REQUIREMENTS_FILE } : {}),
      ...(defaults !== undefined ? { defaults: DEFAULTS_FILE } : {}),
    },
  };
}

export function renderActionPolicy(policy: LoadedActionPolicy): string {
  const lines = ["| 类别 | 裁决 | 来源 |", "|---|---|---|", ...OPERATION_CATEGORIES.map((category) => `| ${category} | ${policy.matrix[category]} | ${policy.sources[category]} |`)];
  for (const clamp of policy.clamped) lines.push(`⚠ ${clamp.category}: 请求 ${clamp.requested} 被底线压回 ${clamp.enforced}`);
  lines.push(`文件: requirements=${policy.files.requirements ?? "(内建)"} defaults=${policy.files.defaults ?? "(内建)"}；记住的批准只穿透 L0–L2`);
  return lines.join("\n");
}
