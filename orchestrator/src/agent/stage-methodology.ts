import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveKunpengHome } from "../util/kunpeng-home.js";
import { EVALUATOR_SYSTEM } from "../verify/evaluator.js";

export type MethodologyStage = "plan" | "implement" | "verify";
export type MethodologyHost = "claude" | "codex";

export const FALLBACK_METHODOLOGY: Record<MethodologyStage, string> = {
  plan: `为该需求产出 spec（含明确、可客观判定的验收标准）。最后单独输出一行：TESTCMD: <一条能客观验证这些验收标准的命令>。该命令将固定用于判定实现是否合格——实现者无权更改它（C3）。`,
  implement: `按给定的 spec / 验收标准在当前工作目录内实现，直接修改/新建文件。验证命令已由 spec 阶段固定，你不要自行定义任何验证命令，只负责让实现真正满足验收标准。`,
  verify: EVALUATOR_SYSTEM,
};

export function applyHostSections(body: string, host: MethodologyHost): string {
  return body.replace(
    /<!-- host:([^\s>]+) -->([\s\S]*?)<!-- \/host -->/g,
    (_match, name: string, content: string) => name === host ? content : "",
  ).replace(/\n{3,}/g, "\n\n").trim();
}

export function stageMethodologyRoot(env: NodeJS.ProcessEnv = process.env): string {
  return resolveKunpengHome(env);
}

export function loadStageMethodology(
  stage: MethodologyStage,
  host: MethodologyHost,
  opts?: { root?: string },
): string {
  try {
    let body = readFileSync(join(opts?.root ?? stageMethodologyRoot(), "skills", stage, "SKILL.md"), "utf8");
    if (body.startsWith("---")) {
      const frontmatter = /^---\r?\n(?:[\s\S]*?\r?\n)?---(?:\r?\n|$)/.exec(body);
      if (!frontmatter) return FALLBACK_METHODOLOGY[stage];
      body = body.slice(frontmatter[0].length);
    }
    return applyHostSections(body, host) || FALLBACK_METHODOLOGY[stage];
  } catch {
    return FALLBACK_METHODOLOGY[stage];
  }
}
