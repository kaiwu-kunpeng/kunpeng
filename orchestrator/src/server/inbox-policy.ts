import { readFileSync, promises as fs } from "node:fs";
import { dirname } from "node:path";

export interface InboxPolicy {
  dailyHardCapPerProject: number;
  gateTtlHours: number;
  absence?: { until: number; note?: string };
}

export const DEFAULT_INBOX_POLICY: InboxPolicy = { dailyHardCapPerProject: 5, gateTtlHours: 168 };

export function loadInboxPolicy(path: string): InboxPolicy {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { ...DEFAULT_INBOX_POLICY };

    const record = parsed as Record<string, unknown>;
    const cap = record.dailyHardCapPerProject;
    const ttl = record.gateTtlHours;
    const policy: InboxPolicy = {
      dailyHardCapPerProject: typeof cap === "number" && Number.isInteger(cap) && cap > 0
        ? cap : DEFAULT_INBOX_POLICY.dailyHardCapPerProject,
      gateTtlHours: typeof ttl === "number" && Number.isFinite(ttl) && ttl > 0
        ? ttl : DEFAULT_INBOX_POLICY.gateTtlHours,
    };
    if (typeof record.absence === "object" && record.absence !== null && !Array.isArray(record.absence)) {
      const absence = record.absence as Record<string, unknown>;
      if (typeof absence.until === "number" && Number.isFinite(absence.until)) {
        policy.absence = {
          until: absence.until,
          ...(typeof absence.note === "string" ? { note: absence.note } : {}),
        };
      }
    }
    return policy;
  } catch {
    return { ...DEFAULT_INBOX_POLICY };
  }
}

export async function saveInboxPolicy(path: string, policy: InboxPolicy): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path + ".tmp", JSON.stringify(policy, null, 2), "utf8");
  await fs.rename(path + ".tmp", path);
}
