import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { changePassword } from "../src/server/auth-change.js";
import { buildAuthConfig, writeAuthConfig, readAuthConfig, verifyPassword } from "../src/server/auth.js";

async function seed(dir: string, pw: string) {
  await writeAuthConfig(dir, buildAuthConfig("admin", pw, { salt: "aa".repeat(16), secret: "se".repeat(16), now: 1 }));
}

describe("changePassword", () => {
  it("当前密码错→拒绝且不改密", async () => {
    const d = mkdtempSync(join(tmpdir(), "kp-pw-"));
    await seed(d, "oldpass12");
    const r = await changePassword(d, { currentPassword: "wrongwrong", newPassword: "newpass123" }, { salt: "bb".repeat(16), now: 2 });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("当前密码");
    const after = await readAuthConfig(d);
    expect(verifyPassword("oldpass12", after!.accounts[0])).toBe(true);
  });
  it("新密码太短→拒绝", async () => {
    const d = mkdtempSync(join(tmpdir(), "kp-pw-"));
    await seed(d, "oldpass12");
    const r = await changePassword(d, { currentPassword: "oldpass12", newPassword: "short" }, { salt: "bb".repeat(16), now: 2 });
    expect(r.ok).toBe(false);
  });
  it("当前对+新合法→成功,保留 secret(会话不失效),旧密失效", async () => {
    const d = mkdtempSync(join(tmpdir(), "kp-pw-"));
    await seed(d, "oldpass12");
    const before = await readAuthConfig(d);
    const r = await changePassword(d, { currentPassword: "oldpass12", newPassword: "brandnew99" }, { salt: "bb".repeat(16), now: 2 });
    expect(r.ok).toBe(true);
    const after = await readAuthConfig(d);
    expect(verifyPassword("brandnew99", after!.accounts[0])).toBe(true);
    expect(verifyPassword("oldpass12", after!.accounts[0])).toBe(false);
    expect(after!.secret).toBe(before!.secret);
  });
  it("未启用鉴权→报错不崩", async () => {
    const d = mkdtempSync(join(tmpdir(), "kp-pw-"));
    const r = await changePassword(d, { currentPassword: "x", newPassword: "brandnew99" }, { salt: "bb".repeat(16), now: 2 });
    expect(r.ok).toBe(false);
  });
});
