import { hashPassword, readAuthConfig, verifyPassword, writeAuthConfig } from "./auth.js";

export interface ChangePasswordResult {
  ok: boolean;
  error?: string;
}

export async function changePassword(
  stateDir: string,
  input: { username?: string; currentPassword: string; newPassword: string },
  deps: { salt: string; now: number },
): Promise<ChangePasswordResult> {
  const existing = await readAuthConfig(stateDir);
  if (!existing) return { ok: false, error: "未启用鉴权,无法修改密码" };
  if (!input.newPassword || input.newPassword.length < 8) return { ok: false, error: "新密码至少 8 位" };
  const username = input.username ?? existing.accounts[0]?.username ?? "";
  const account = existing.accounts.find((candidate) => candidate.username === username);
  if (!account) return { ok: false, error: "账号不存在" };
  if (!verifyPassword(input.currentPassword, account)) return { ok: false, error: "当前密码错误" };

  const cfg = {
    ...existing,
    accounts: existing.accounts.map((candidate) => candidate.username === username
      ? {
          ...candidate,
          salt: deps.salt,
          hash: hashPassword(input.newPassword, deps.salt),
          updatedAt: deps.now,
          passwordChangedAt: deps.now,
        }
      : candidate),
  };
  await writeAuthConfig(stateDir, cfg);
  return { ok: true };
}
