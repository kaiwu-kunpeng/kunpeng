export type HostCeiling = "full" | "readonly" | "isolated";
export type WorkMode = "full" | "intranet" | "trip";

export const DENY_HOST_WRITE = ["Edit", "Write", "NotebookEdit"];
export const DENY_HOST_BASH = ["Bash"];
export const DENY_HOST_READ = ["Read"];

export const HOST_TOOLS_READONLY = ["Glob", "Grep", "Read", "Skill", "WebFetch", "WebSearch"];
export const HOST_TOOLS_ISOLATED = ["WebFetch", "WebSearch"];

export interface HostToolPolicy {
  allowTools: string[] | null;
  disallowTools: string[];
  deny: string[];
  codexReadOnly: boolean;
}

function sortedUnion(...rules: string[][]): string[] {
  return [...new Set(rules.flat())].sort();
}

export function resolveHostPermissions(
  ceiling: HostCeiling,
  mode: WorkMode,
): { deny: string[] } {
  const knownCeiling = ["full", "readonly", "isolated"].includes(ceiling);
  const knownMode = ["full", "intranet", "trip"].includes(mode);

  if (!knownCeiling || !knownMode) {
    return { deny: sortedUnion(DENY_HOST_WRITE, DENY_HOST_BASH, DENY_HOST_READ) };
  }

  const ceilingDeny = ceiling === "isolated"
    ? [...DENY_HOST_WRITE, ...DENY_HOST_BASH, ...DENY_HOST_READ]
    : ceiling === "readonly"
      ? [...DENY_HOST_WRITE, ...DENY_HOST_BASH]
      : [];
  const modeDeny = mode === "trip"
    ? [...DENY_HOST_WRITE, ...DENY_HOST_BASH]
    : [];

  return { deny: sortedUnion(ceilingDeny, modeDeny) };
}

// 内网模式为纯标记档，不参与工具收敛。
export function resolveHostToolPolicy(
  ceiling: HostCeiling,
  mode: WorkMode,
): HostToolPolicy {
  const knownCeiling = ["full", "readonly", "isolated"].includes(ceiling);
  const knownMode = ["full", "intranet", "trip"].includes(mode);
  const allowTools: string[] | null = !knownCeiling || !knownMode || ceiling === "isolated"
    ? [...HOST_TOOLS_ISOLATED]
    : ceiling === "readonly" || mode === "trip"
      ? [...HOST_TOOLS_READONLY]
      : null;
  const disallowTools: string[] = [];

  return {
    allowTools,
    disallowTools,
    deny: resolveHostPermissions(ceiling, mode).deny,
    codexReadOnly: allowTools !== null,
  };
}
