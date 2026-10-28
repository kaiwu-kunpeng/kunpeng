import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { kunpengStateDir } from "../../project/state-dir.js";
import { writeFileAtomic } from "../../util/atomic-write.js";

export interface Revocation {
  accountId: string;
  machineId: string;
  at?: number;
  reason?: string;
}

export type RevocationState =
  | { ok: true; list: Revocation[] }
  | { ok: false; error: string };

export function parseRevocations(raw: string | null): RevocationState {
  if (raw === null || raw.trim() === "") return { ok: true, list: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "吊销名单 JSON 解析失败" };
  }

  if (
    typeof parsed !== "object"
    || parsed === null
    || Array.isArray(parsed)
    || !("revoked" in parsed)
    || !Array.isArray(parsed.revoked)
  ) {
    return { ok: false, error: "吊销名单格式错误：revoked 必须是数组" };
  }

  const list: Revocation[] = [];
  for (const item of parsed.revoked) {
    if (
      typeof item !== "object"
      || item === null
      || Array.isArray(item)
      || !("accountId" in item)
      || typeof item.accountId !== "string"
      || item.accountId.trim() === ""
      || !("machineId" in item)
      || typeof item.machineId !== "string"
      || item.machineId.trim() === ""
    ) continue;

    list.push({
      accountId: item.accountId,
      machineId: item.machineId,
      ...(typeof item.at === "number" && Number.isFinite(item.at) ? { at: item.at } : {}),
      ...(typeof item.reason === "string" ? { reason: item.reason } : {}),
    });
  }

  return { ok: true, list };
}

export function isRevoked(
  list: Revocation[],
  accountId: string,
  machineId: string,
): boolean {
  return list.some((entry) => (
    entry.accountId === accountId && entry.machineId === machineId
  ));
}

export function revocationFilePath(env?: NodeJS.ProcessEnv): string {
  return join(kunpengStateDir(env), "worker-revoked.json");
}

export function addRevocation(list: Revocation[], entry: Revocation): Revocation[] {
  const next = list.filter((current) => (
    current.accountId !== entry.accountId || current.machineId !== entry.machineId
  ));
  next.push({ ...entry });

  return next.sort((left, right) => {
    if (left.accountId < right.accountId) return -1;
    if (left.accountId > right.accountId) return 1;
    if (left.machineId < right.machineId) return -1;
    if (left.machineId > right.machineId) return 1;
    return 0;
  });
}

export function removeRevocation(
  list: Revocation[],
  accountId: string,
  machineId: string,
): Revocation[] {
  if (!isRevoked(list, accountId, machineId)) return list;
  return list.filter((entry) => (
    entry.accountId !== accountId || entry.machineId !== machineId
  ));
}

export function serializeRevocations(list: Revocation[]): string {
  return `${JSON.stringify({ revoked: list })}\n`;
}

export async function saveRevocations(
  list: Revocation[],
  env?: NodeJS.ProcessEnv,
): Promise<void> {
  const path = revocationFilePath(env);
  await mkdir(dirname(path), { recursive: true });
  await writeFileAtomic(path, serializeRevocations(list));
}
