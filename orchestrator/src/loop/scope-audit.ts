export interface ScopeAuditVerdict { strong: boolean; reason: string }

export function hasScopeBlock(text: string): boolean {
  for (const match of text.matchAll(/^```([^\r\n`]*)\r?\n([\s\S]*?)\r?\n```[ \t]*$/gm)) {
    if ((match[1] ?? "").trim() !== "scope") continue;
    const body = match[2] ?? "";
    if (body.split(/\r?\n/).some((line) => line.startsWith("allow:") && line.slice("allow:".length).trim().length > 0)) {
      return true;
    }
  }
  return false;
}

export function auditScope(specText: string, requirementText: string): ScopeAuditVerdict {
  if (hasScopeBlock(specText) || hasScopeBlock(requirementText)) {
    return { strong: true, reason: "发现有效 scope 声明" };
  }
  return { strong: false, reason: "缺少有效 scope 声明：spec 与 requirement 均未提供含 allow: 的 scope 块" };
}
