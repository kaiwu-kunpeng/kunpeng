import { readdir, readFile, appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export interface AuditEntry {
  at: number;
  action: string;
  user?: string;
  path?: string;
  status?: string;
  detail?: string;
}

export function isAuditableApiWrite(method: string, path: string): boolean {
  return (method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE")
    && path.startsWith("/api/");
}

function auditDir(stateDir: string): string {
  return join(stateDir, "audit");
}

function auditFileName(at: number): string {
  const date = new Date(at);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `audit-${year}-${month}.jsonl`;
}

export async function appendAudit(stateDir: string, entry: AuditEntry): Promise<void> {
  try {
    const dir = auditDir(stateDir);
    await mkdir(dir, { recursive: true });
    await appendFile(join(dir, auditFileName(entry.at)), `${JSON.stringify(entry)}\n`, "utf8");
  } catch {
    // 审计失败不能影响主请求路径。
  }
}

export async function readAuditTail(stateDir: string, n: number): Promise<AuditEntry[]> {
  try {
    const dir = auditDir(stateDir);
    const files = (await readdir(dir))
      .filter((file) => /^audit-\d{4}-\d{2}\.jsonl$/.test(file))
      .sort();
    const entries: AuditEntry[] = [];
    for (const file of files) {
      const raw = await readFile(join(dir, file), "utf8");
      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as AuditEntry;
          if (typeof parsed.at === "number" && typeof parsed.action === "string") entries.push(parsed);
        } catch {
          // 坏行跳过，保留其它审计记录可读。
        }
      }
    }
    return entries.slice(Math.max(0, entries.length - n));
  } catch {
    return [];
  }
}
