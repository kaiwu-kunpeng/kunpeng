import { isRecord } from "../util/is-record.js";
import * as fs from "fs/promises";
import { readdirSync } from "node:fs";
import * as path from "path";
import * as os from "os";
import type { QuotaTracker } from "./quota-tracker.js";

export interface Account {
  id: string;
  name?: string;
  backend?: "claude" | "codex";
  env?: Record<string, string>;
  limit?: number;
  windowHours?: number;
}

export function expandEnv(env: Record<string, string>): Record<string, string> {
  const home = os.homedir();
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string" && value.startsWith("~")) {
      result[key] = path.join(home, value.slice(1));
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function sanitizeAccountEnv(env: Record<string, string>): Record<string, string> {
  const result = { ...env };
  if (result.CLAUDE_CONFIG_DIR === path.join(os.homedir(), ".claude")) {
    delete result.CLAUDE_CONFIG_DIR;
  }
  if (result.CODEX_HOME === path.join(os.homedir(), ".codex")) {
    delete result.CODEX_HOME;
  }
  return result;
}

export type AccountHealth = { ok: boolean; reason?: string };

/** 预检账号 env 指向的凭证目录：存在且非空才算健康；未注入重定向 = 用默认登录态，视为健康。 */
export function checkAccountEnvHealth(
  env: Record<string, string> | undefined
): AccountHealth {
  if (!env) return { ok: true };
  for (const key of ["CLAUDE_CONFIG_DIR", "CODEX_HOME"] as const) {
    const dir = env[key];
    if (!dir) continue;
    try {
      if (readdirSync(dir).length === 0) {
        return { ok: false, reason: `${key} 目录为空(未登录?): ${dir}` };
      }
    } catch {
      return { ok: false, reason: `${key} 目录不存在或不可读: ${dir}` };
    }
  }
  return { ok: true };
}

export function resolveAccounts(raw: unknown[]): Account[] {
  const accounts: Account[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];

    if (!isRecord(item)) {
      throw new Error(`Account at index ${i}: account must be an object`);
    }

    if (!item.id) {
      throw new Error(`Account at index ${i}: id is required`);
    }

    if (typeof item.id !== "string") {
      throw new Error(`Account at index ${i}: id must be a string`);
    }

    let env: Record<string, string> | undefined;
    if (item.env !== undefined) {
      if (!isRecord(item.env)) {
        throw new Error(
          `Account "${item.id}": env must be Record<string, string>`
        );
      }
      for (const [key, value] of Object.entries(item.env)) {
        if (typeof value !== "string") {
          throw new Error(
            `Account "${item.id}": env values must be strings, got ${typeof value} for key "${key}"`
          );
        }
      }
      env = item.env as Record<string, string>;
    }

    if (item.limit !== undefined) {
      if (typeof item.limit !== "number") {
        throw new Error(
          `Account "${item.id}": limit must be a number, got ${typeof item.limit}`
        );
      }
      if (item.limit <= 0) {
        throw new Error(
          `Account "${item.id}": limit must be a positive number, got ${item.limit}`
        );
      }
    }

    if (item.windowHours !== undefined) {
      if (typeof item.windowHours !== "number") {
        throw new Error(
          `Account "${item.id}": windowHours must be a number, got ${typeof item.windowHours}`
        );
      }
      if (item.windowHours <= 0) {
        throw new Error(
          `Account "${item.id}": windowHours must be a positive number, got ${item.windowHours}`
        );
      }
    }

    if (item.name !== undefined) {
      if (typeof item.name !== "string" || item.name.length === 0) {
        throw new Error(`Account "${item.id}": name must be a non-empty string`);
      }
    }

    if (item.backend !== undefined) {
      if (item.backend !== "claude" && item.backend !== "codex") {
        throw new Error(`Account "${item.id}": backend must be "claude" or "codex"`);
      }
    }

    accounts.push({
      id: item.id,
      ...(item.name !== undefined && { name: item.name }),
      ...(item.backend !== undefined && { backend: item.backend }),
      ...(env && { env }),
      ...(item.limit !== undefined && { limit: item.limit }),
      ...(item.windowHours !== undefined && { windowHours: item.windowHours }),
    });
  }
  return accounts;
}

export async function loadAccounts(
  opts?: {
    home?: string;
    envPath?: string;
  }
): Promise<Account[]> {
  const home = opts?.home || os.homedir();
  const envPath = opts?.envPath || process.env.KUNPENG_ACCOUNTS;
  const defaultPath = path.join(home, ".kunpeng", "accounts.json");

  let filePath: string | null = null;

  if (envPath) {
    try {
      await fs.access(envPath);
      filePath = envPath;
    } catch {
      // File doesn't exist, try next location
    }
  }

  if (!filePath) {
    try {
      await fs.access(defaultPath);
      filePath = defaultPath;
    } catch {
      // File doesn't exist, return empty array
      return [];
    }
  }

  try {
    const content = await fs.readFile(filePath, "utf-8");
    const raw = JSON.parse(content);

    if (!Array.isArray(raw)) {
      throw new Error(
        "accounts.json must contain an array of account objects"
      );
    }

    if (raw.length === 0) {
      return [];
    }

    const resolved = resolveAccounts(raw);

    for (const account of resolved) {
      if (account.env) {
        const env = sanitizeAccountEnv(expandEnv(account.env));
        if (Object.keys(env).length > 0) {
          account.env = env;
        } else {
          delete account.env;
        }
      }
    }

    return resolved;
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes("Account")) {
      throw e;
    }
    if (e instanceof SyntaxError) {
      throw new Error(`Failed to parse accounts.json: ${e.message}`, { cause: e });
    }
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(`Failed to load accounts from ${filePath}: ${message}`, { cause: e });
  }
}

export class AccountPool {
  private readonly accounts: Account[];
  private cursor = 0;

  constructor(accounts: Account[]) {
    this.accounts = [...accounts];
  }

  next(): Account {
    if (this.accounts.length === 0) {
      throw new Error("account pool is empty");
    }
    const account = this.accounts[this.cursor];
    this.cursor = (this.cursor + 1) % this.accounts.length;
    return account;
  }

  get size(): number {
    return this.accounts.length;
  }
}

export function pickAccount(
  accounts: Account[],
  quota: QuotaTracker,
  now: number,
  backend?: "claude" | "codex"
): Account | undefined {
  if (accounts.length === 0) {
    throw new Error("未配置账号");
  }

  let candidates = accounts.filter(
    (candidate) =>
      candidate.backend === undefined ||
      backend === undefined ||
      candidate.backend === backend
  );
  if (candidates.length === 0) {
    return undefined;
  }

  const preflightFailures: string[] = [];
  const healthyCandidates = candidates.filter((account) => {
    const health = checkAccountEnvHealth(account.env);
    if (health.ok) {
      return true;
    }
    const reason = health.reason ?? "未知原因";
    preflightFailures.push(reason);
    console.warn(
      `[账号] ${account.name ?? account.id} 登录态预检失败,已跳过: ${reason}`
    );
    return false;
  });
  if (healthyCandidates.length === 0) {
    throw new Error(
      `所有匹配账号登录态预检失败(检查 CLAUDE_CONFIG_DIR/CODEX_HOME 指向的目录): ${preflightFailures[0]}`
    );
  }
  candidates = healthyCandidates;

  let best: Account | undefined;
  let bestTotal = Number.POSITIVE_INFINITY;

  for (const account of candidates) {
    const total = quota.accountTotal(account.id, now);
    const exhausted = account.limit !== undefined && total >= account.limit;
    if (exhausted) {
      continue;
    }

    if (total < bestTotal) {
      best = account;
      bestTotal = total;
    }
  }

  if (best) {
    return best;
  }

  const resetMs = nearestResetMs(candidates, quota, now);
  const resetMinutes =
    resetMs === undefined ? 0 : Math.ceil(resetMs / 60_000);
  throw new Error(`所有账号配额耗尽，最近重置约 ${resetMinutes}m 后`);
}

function nearestResetMs(
  accounts: Account[],
  quota: QuotaTracker,
  now: number
): number | undefined {
  let nearest: number | undefined;

  for (const account of accounts) {
    const resetMs =
      quota.windowResetMs(account.id, now) ??
      (account.windowHours !== undefined
        ? account.windowHours * 3_600_000
        : undefined);

    if (resetMs === undefined) {
      continue;
    }

    if (nearest === undefined || resetMs < nearest) {
      nearest = resetMs;
    }
  }

  return nearest;
}
