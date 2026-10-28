import { detectScopeDrift, unquoteGitPath, type ScopeDecl, type ScopeViolation } from "./scope-gate.js";

export function resolveRequireScope(env: NodeJS.ProcessEnv): boolean {
  return !["0", "false", "off", "no"].includes((env.KUNPENG_REQUIRE_SCOPE ?? "").trim().toLowerCase());
}

// docs/specs/ 不豁免：loop 从不往那里写，出现在那里的只会是实现者越界写的 spec 副本（C10）。
export function isMachineSpecCopy(path: string): boolean {
  return /^orchestrator\/specs\/[^/]+\.spec\.(md|html)$/.test(path);
}

export function isAgentRegistryFile(path: string): boolean {
  return path.split("/").at(-1) === "AGENTS-ACTIVE.md"
    || /(?:^|\/)\.kunpeng\/agents-active\/.+\.md$/.test(path);
}

export function parseChangedPaths(nameOnlyOutput: string): string[] {
  return nameOnlyOutput.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map(unquoteGitPath);
}

export type ScopeMainReason = "scope-missing" | "scope-malformed" | "allow-missing" | "drift";

export type ScopeMainVerdict =
  | { ok: true; skipped: boolean; changedFiles: string[] }
  | { ok: false; reason: ScopeMainReason; changedFiles: string[]; violations: ScopeViolation[]; message: string };

export function evaluateScopeOnMainPath(
  changedFiles: string[],
  scope: ScopeDecl | undefined,
  opts: { requireScope: boolean },
): ScopeMainVerdict {
  const files = changedFiles.filter((path) => !isMachineSpecCopy(path) && !isAgentRegistryFile(path));
  if (scope === undefined) {
    return opts.requireScope
      ? {
          ok: false, reason: "scope-missing", changedFiles: files, violations: [],
          message: "范围门：需求/spec 未声明 scope 范围（设 KUNPENG_REQUIRE_SCOPE=0 可回到旧行为）",
        }
      : { ok: true, skipped: true, changedFiles: files };
  }
  if (scope.malformed === true) {
    return {
      ok: false, reason: "scope-malformed", changedFiles: files,
      violations: detectScopeDrift(files, scope).violations,
      message: "范围门：scope 声明无法解析",
    };
  }
  if (scope.allow.length === 0) {
    return {
      ok: false, reason: "allow-missing", changedFiles: files, violations: [],
      message: "范围门：scope 只声明了 forbid、没有 allow",
    };
  }
  const { violations } = detectScopeDrift(files, scope);
  if (violations.length > 0) {
    return {
      ok: false, reason: "drift", changedFiles: files, violations,
      message: "范围门未通过：" + violations.map(({ file, rule }) => `${file}（${rule}）`).join(", "),
    };
  }
  return { ok: true, skipped: false, changedFiles: files };
}
