import { ACTION_LEVELS, isActionLevel, type ActionLevel } from "../policy/action-levels.js";
import { isRecord } from "../util/is-record.js";
import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface OpsGateDecider {
  by: "human";
  via: string;
  who?: string;
}

export interface OpsGateEntry {
  id: string;
  projectId: string;
  playbookId: string;
  loopId: string;
  reason: string;
  /** 该运营 loop 杠杆里的最高动作等级（policy/action-levels 单一来源）；旧门缺省。 */
  level?: ActionLevel;
  status: "pending" | "approved" | "rejected";
  createdAt: number;
  decidedAt?: number;
  decidedBy?: OpsGateDecider;
  /** 批条消费时刻：一次批准只放行一波。 */
  consumedAt?: number;
}

type OpsGateDraft = Omit<OpsGateEntry, "id" | "status" | "createdAt">;
type OpsGateDecision = "approved" | "rejected";

/** 运营 loop 杠杆里的最高动作等级；没有任何杠杆声明等级时返回 undefined。 */
export function maxLeverLevel(levers: ReadonlyArray<{ level?: ActionLevel }> | undefined): ActionLevel | undefined {
  let max: ActionLevel | undefined;
  for (const lever of levers ?? []) {
    if (lever.level && (max === undefined || ACTION_LEVELS.indexOf(lever.level) > ACTION_LEVELS.indexOf(max))) max = lever.level;
  }
  return max;
}

export function opsGateAuditPath(repoRoot: string): string {
  return join(repoRoot, ".kunpeng", "audit", "ops-gates.jsonl");
}

export function isTamperedOpsGate(gate: Pick<OpsGateEntry, "status" | "decidedBy">): boolean {
  return gate.status !== "pending" && !gate.decidedBy;
}

export async function createOpsGate(repoRoot: string, entry: OpsGateDraft, now = Date.now()): Promise<OpsGateEntry> {
  const existing = (await listOpsGates(repoRoot)).find(
    (gate) => gate.playbookId === entry.playbookId && gate.status === "pending",
  );
  if (existing) return existing;

  const gate: OpsGateEntry = {
    id: `opsgate-${now.toString(36)}`,
    projectId: entry.projectId,
    playbookId: entry.playbookId,
    loopId: entry.loopId,
    reason: entry.reason,
    ...(entry.level ? { level: entry.level } : {}),
    status: "pending",
    createdAt: now,
  };

  await writeOpsGate(repoRoot, gate);
  return gate;
}

/** 消费同 loop 中最早的有效批条；旧门缺等级按 L3 计。 */
export async function consumeApprovedOpsGate(
  repoRoot: string,
  need: { loopId: string; level: ActionLevel },
  now = Date.now(),
): Promise<OpsGateEntry | null> {
  const rank = (level: ActionLevel | undefined): number => ACTION_LEVELS.indexOf(level ?? "L3");
  const ticket = (await listOpsGates(repoRoot)).find(
    (gate) => gate.loopId === need.loopId && gate.status === "approved" && gate.consumedAt === undefined
      && !isTamperedOpsGate(gate) && rank(gate.level) >= rank(need.level),
  );
  if (!ticket) return null;
  const consumed: OpsGateEntry = { ...ticket, consumedAt: now };
  await writeOpsGate(repoRoot, consumed);
  return consumed;
}

export async function listOpsGates(repoRoot: string): Promise<OpsGateEntry[]> {
  const dir = opsGateDir(repoRoot);
  let files: string[];
  try {
    files = await readdir(dir);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return [];
    throw error;
  }

  const gates = await Promise.all(
    files
      .filter((file) => file.endsWith(".json"))
      .map(async (file) => readOpsGate(join(dir, file))),
  );
  return gates.sort((a, b) => a.createdAt - b.createdAt);
}

export async function decideOpsGate(
  repoRoot: string,
  id: string,
  decision: OpsGateDecision,
  decidedBy: OpsGateDecider,
  now = Date.now(),
): Promise<OpsGateEntry | null> {
  if (typeof decidedBy !== "object" || decidedBy === null || decidedBy.by !== "human"
    || typeof decidedBy.via !== "string" || decidedBy.via.length === 0) {
    throw new Error('ops gate decision requires decidedBy { by: "human", via }');
  }
  const path = opsGatePath(repoRoot, id);
  let gate: OpsGateEntry;
  try {
    gate = await readOpsGate(path);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null;
    throw error;
  }

  if (gate.status !== "pending") return null;

  const { via, who } = decidedBy;
  const decided: OpsGateEntry = {
    ...gate,
    status: decision,
    decidedAt: now,
    decidedBy: { by: "human", via, ...(who ? { who } : {}) },
  };
  await writeOpsGate(repoRoot, decided);
  const auditPath = opsGateAuditPath(repoRoot);
  await mkdir(dirname(auditPath), { recursive: true });
  await appendFile(auditPath, `${JSON.stringify({
    at: now, id, playbookId: decided.playbookId, loopId: decided.loopId, decision, decidedBy: decided.decidedBy,
  })}\n`);
  return decided;
}

function opsGateDir(repoRoot: string): string {
  return join(repoRoot, ".kunpeng", "ops-gates");
}

function opsGatePath(repoRoot: string, id: string): string {
  return join(opsGateDir(repoRoot), `${id}.json`);
}

async function readOpsGate(path: string): Promise<OpsGateEntry> {
  const raw = await readFile(path, "utf8");
  return parseOpsGateEntry(JSON.parse(raw) as unknown, path);
}

async function writeOpsGate(repoRoot: string, gate: OpsGateEntry): Promise<void> {
  const dir = opsGateDir(repoRoot);
  await mkdir(dir, { recursive: true });

  const target = opsGatePath(repoRoot, gate.id);
  const tmp = join(dir, `.${gate.id}.${process.pid}.${randomUUID()}.tmp`);
  await writeFile(tmp, `${JSON.stringify(gate, null, 2)}\n`, "utf8");
  await rename(tmp, target);
}

function parseOpsGateEntry(value: unknown, path: string): OpsGateEntry {
  if (!isRecord(value)) throw new Error(`Invalid ops gate entry: ${path}`);

  const id = readString(value, "id", path);
  const projectId = readString(value, "projectId", path);
  const playbookId = readString(value, "playbookId", path);
  const loopId = readString(value, "loopId", path);
  const reason = readString(value, "reason", path);
  const status = readStatus(value.status, path);
  const createdAt = readNumber(value, "createdAt", path);
  const decidedAt = value.decidedAt === undefined ? undefined : readNumber(value, "decidedAt", path);
  const consumedAt = value.consumedAt === undefined ? undefined : readNumber(value, "consumedAt", path);
  let decidedBy: OpsGateDecider | undefined;
  if (value.decidedBy !== undefined) {
    const raw = value.decidedBy;
    if (!isRecord(raw) || raw.by !== "human" || typeof raw.via !== "string" || raw.via.length === 0
      || (raw.who !== undefined && typeof raw.who !== "string")) {
      throw new Error(`Invalid ops gate entry decidedBy: ${path}`);
    }
    decidedBy = { by: "human", via: raw.via, ...(raw.who !== undefined ? { who: raw.who } : {}) };
  }

  // 等级写坏不抛（数据目录会积累旧垢物）：忽略后展示侧按 L3 保守处理。
  const level = isActionLevel(value.level) ? value.level : undefined;
  return { id, projectId, playbookId, loopId, reason, status, createdAt, decidedAt, ...(level ? { level } : {}), ...(consumedAt === undefined ? {} : { consumedAt }), ...(decidedBy ? { decidedBy } : {}) };
}

function readString(value: Record<string, unknown>, key: string, path: string): string {
  const raw = value[key];
  if (typeof raw !== "string") throw new Error(`Invalid ops gate entry ${key}: ${path}`);
  return raw;
}

function readNumber(value: Record<string, unknown>, key: string, path: string): number {
  const raw = value[key];
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    throw new Error(`Invalid ops gate entry ${key}: ${path}`);
  }
  return raw;
}

function readStatus(value: unknown, path: string): OpsGateEntry["status"] {
  if (value === "pending" || value === "approved" || value === "rejected") return value;
  throw new Error(`Invalid ops gate entry status: ${path}`);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
