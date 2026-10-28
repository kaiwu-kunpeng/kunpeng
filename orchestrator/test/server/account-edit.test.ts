import { describe, it, expect } from "vitest";
import { editAccount, addAccount, verifyPassword, hashPassword } from "../../src/server/auth.js";
import type { AuthConfig } from "../../src/server/auth.js";

const base: AuthConfig = {
  secret: "s",
  accounts: [
    { username: "admin", salt: "sa", hash: hashPassword("oldpw", "sa"), profileId: "home", role: "owner", updatedAt: 0 },
    { username: "bob", salt: "sb", hash: hashPassword("bobpw", "sb"), profileId: "client-x", role: "member", updatedAt: 0 },
  ],
};

describe("editAccount", () => {
  it("改名：bob → bobby，记录改名且旧名消失，原 cfg 不变（不可变）", () => {
    const next = editAccount(base, { username: "bob", newUsername: "bobby", now: 1 });
    expect(next.accounts.map((a) => a.username).sort()).toEqual(["admin", "bobby"]);
    expect(base.accounts.some((a) => a.username === "bob")).toBe(true); // 原对象不被修改
  });

  it("改名碰撞已存在用户名 → 抛错", () => {
    expect(() => editAccount(base, { username: "bob", newUsername: "admin", now: 1 })).toThrow(/已存在/);
  });

  it("目标账号不存在 → 抛错", () => {
    expect(() => editAccount(base, { username: "ghost", newUsername: "x", now: 1 })).toThrow(/不存在/);
  });

  it("尚有其他 owner 时，可把某 owner 降级为 member", () => {
    const two = addAccount(base, { username: "admin2", password: "pw", profileId: "home", role: "owner", salt: "s2", now: 1 });
    const next = editAccount(two, { username: "admin", role: "member", now: 2 });
    expect(next.accounts.find((a) => a.username === "admin")?.role).toBe("member");
    expect(next.accounts.some((a) => a.role === "owner")).toBe(true);
  });

  it("不能把最后一个 owner 降级为 member（防锁死）", () => {
    expect(() => editAccount(base, { username: "admin", role: "member", now: 1 })).toThrow(/owner/);
  });

  it("重置密码：新密码可验证通过、旧密码失效", () => {
    const next = editAccount(base, { username: "bob", newPassword: "newpw", salt: "sb2", now: 1 });
    const updated = next.accounts.find((a) => a.username === "bob")!;
    expect(verifyPassword("newpw", updated)).toBe(true);
    expect(verifyPassword("bobpw", updated)).toBe(false);
  });

  it("改 profile：只改 profileId，其余字段不变", () => {
    const next = editAccount(base, { username: "bob", profileId: "client-y", now: 1 });
    const updated = next.accounts.find((a) => a.username === "bob")!;
    expect(updated.profileId).toBe("client-y");
    expect(updated.role).toBe("member");
    expect(updated.username).toBe("bob");
  });

  it("部分更新：只传 role，username/profile 保持原样", () => {
    const two = addAccount(base, { username: "admin2", password: "pw", profileId: "home", role: "owner", salt: "s2", now: 1 });
    const next = editAccount(two, { username: "bob", role: "owner", now: 2 });
    const updated = next.accounts.find((a) => a.username === "bob")!;
    expect(updated.role).toBe("owner");
    expect(updated.username).toBe("bob");
    expect(updated.profileId).toBe("client-x");
  });
});
