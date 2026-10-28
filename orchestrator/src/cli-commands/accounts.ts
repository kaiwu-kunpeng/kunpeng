import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  checkAccountEnvHealth,
  expandEnv,
  resolveAccounts,
  type Account,
} from "../agent/account-pool.js";
import { loadQuota } from "../agent/quota-tracker.js";
import { registerCliCommand, type CliContext } from "./registry.js";
import { valueAfter } from "./shared.js";

const USAGE = "用法: kunpeng account <list|add|remove|doctor> ...";

async function readAccountsRaw(accountsPath: string): Promise<unknown[]> {
  let content: string;
  try {
    content = await readFile(accountsPath, "utf8");
  } catch (error: unknown) {
    if (
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return [];
    }
    throw error;
  }

  const raw: unknown = JSON.parse(content);
  if (!Array.isArray(raw)) {
    throw new Error("accounts.json 必须包含账号数组");
  }
  return raw;
}

async function writeAccountsRaw(accountsPath: string, raw: unknown[]): Promise<void> {
  await mkdir(dirname(accountsPath), { recursive: true });
  await writeFile(accountsPath, JSON.stringify(raw, null, 2), "utf8");
}

function fail(message: string): void {
  console.error(message);
  process.exitCode = 1;
}

function optionValue(context: CliContext, flag: string): string | undefined {
  return valueAfter(context.rest, flag) ?? valueAfter(context.argv, flag);
}

function positiveNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

async function listAccounts(context: CliContext, accountsPath: string): Promise<void> {
  const raw = await readAccountsRaw(accountsPath);
  const accounts = resolveAccounts(raw);
  if (accounts.length === 0) {
    console.log("(无账号)用 kunpeng account add <名> --backend claude|codex [--cred-dir <凭证目录>] 添加");
    return;
  }

  const quota = await loadQuota(join(context.kunpengHome, ".kunpeng", "quota.json"));
  const now = Date.now();
  for (const account of accounts) {
    const health = checkAccountEnvHealth(account.env ? expandEnv(account.env) : undefined);
    const healthText = health.ok ? "✓" : `✗ ${health.reason ?? "未知原因"}`;
    const usage = quota.accountTotal(account.id, now);
    console.log(
      `${account.name ?? account.id} ｜ ${account.backend ?? "通用"} ｜ 预检 ${healthText} ｜ 本窗口用量 ${usage} / ${account.limit ?? "无上限"}`,
    );
  }
}

async function addAccount(context: CliContext, accountsPath: string): Promise<void> {
  const name = context.rest[1];
  if (!name || name.startsWith("--")) {
    fail("账号名必填");
    return;
  }

  const backend = optionValue(context, "--backend");
  if (backend !== "claude" && backend !== "codex") {
    fail("--backend 必须是 claude 或 codex");
    return;
  }

  const raw = await readAccountsRaw(accountsPath);
  const accounts = resolveAccounts(raw);
  if (accounts.some((account) => account.id === name || account.name === name)) {
    fail(`账号已存在: ${name}`);
    return;
  }

  const credDir = optionValue(context, "--cred-dir");
  const limit = positiveNumber(optionValue(context, "--limit") ?? context.limitArg);
  const windowHours = positiveNumber(optionValue(context, "--window"));
  const entry: Account = {
    id: name,
    name,
    backend,
    ...(credDir && {
      env: {
        [backend === "claude" ? "CLAUDE_CONFIG_DIR" : "CODEX_HOME"]: credDir,
      },
    }),
    ...(limit !== undefined && { limit }),
    ...(windowHours !== undefined && { windowHours }),
  };

  raw.push(entry);
  await writeAccountsRaw(accountsPath, raw);
  console.log(`[账号] 已添加 ${name}(${backend})`);

  if (credDir && entry.env) {
    const health = checkAccountEnvHealth(expandEnv(entry.env));
    if (!health.ok) {
      console.warn(
        `[账号] 登录态预检未通过: ${health.reason ?? "未知原因"}；请先在该凭证目录完成登录`,
      );
    }
  }
}

async function removeAccount(context: CliContext, accountsPath: string): Promise<void> {
  const name = context.rest[1];
  if (!name || name.startsWith("--")) {
    fail("账号名必填");
    return;
  }

  const raw = await readAccountsRaw(accountsPath);
  const accounts = resolveAccounts(raw);
  const index = accounts.findIndex((account) => account.id === name || account.name === name);
  if (index < 0) {
    fail(`账号不存在: ${name}`);
    return;
  }

  raw.splice(index, 1);
  await writeAccountsRaw(accountsPath, raw);
  console.log(`[账号] 已移除 ${name}`);
}

async function doctorAccounts(accountsPath: string): Promise<void> {
  const raw = await readAccountsRaw(accountsPath);
  const accounts = resolveAccounts(raw);
  let allHealthy = true;
  for (const account of accounts) {
    const health = checkAccountEnvHealth(account.env ? expandEnv(account.env) : undefined);
    const name = account.name ?? account.id;
    if (health.ok) {
      console.log(`✓ ${name}`);
    } else {
      allHealthy = false;
      console.log(`✗ ${name} ${health.reason ?? "未知原因"}`);
    }
  }
  if (allHealthy) console.log("全部账号登录态预检通过");
}

async function run(context: CliContext): Promise<void> {
  const accountsPath = process.env.KUNPENG_ACCOUNTS ?? join(context.kunpengHome, ".kunpeng", "accounts.json");
  const subcommand = context.rest[0];
  if (!subcommand || !["list", "add", "remove", "doctor"].includes(subcommand)) {
    fail(USAGE);
    return;
  }

  try {
    if (subcommand === "list") await listAccounts(context, accountsPath);
    else if (subcommand === "add") await addAccount(context, accountsPath);
    else if (subcommand === "remove") await removeAccount(context, accountsPath);
    else await doctorAccounts(accountsPath);
  } catch (error: unknown) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

registerCliCommand({ name: "account", run });
