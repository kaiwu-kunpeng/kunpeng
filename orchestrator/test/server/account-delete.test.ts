import { describe, it, expect } from "vitest";
import { deleteAccount, addAccount } from "../../src/server/auth.js";
import type { AuthConfig } from "../../src/server/auth.js";

const base: AuthConfig = {
  secret: "s",
  accounts: [
    { username: "admin", salt: "sa", hash: "h", profileId: "home", role: "owner", updatedAt: 0 },
    { username: "bob", salt: "sb", hash: "h", profileId: "client-x", role: "member", updatedAt: 0 },
  ],
};

describe("deleteAccount", () => {
  it("删除已存在的 member，返回新 cfg 且不改原 cfg（不可变）", () => {
    const next = deleteAccount(base, "bob");
    expect(next.accounts.map((a) => a.username)).toEqual(["admin"]);
    expect(base.accounts.length).toBe(2); // 原对象不被修改
  });

  it("删不存在的账号 → 抛错", () => {
    expect(() => deleteAccount(base, "ghost")).toThrow(/不存在/);
  });

  it("不能删除最后一个 owner（防锁死）", () => {
    expect(() => deleteAccount(base, "admin")).toThrow(/owner/);
  });

  it("尚有其他 owner 时，可以删除某个 owner", () => {
    const two = addAccount(base, {
      username: "admin2", password: "pw", profileId: "home", role: "owner", salt: "s2", now: 1,
    });
    const next = deleteAccount(two, "admin");
    expect(next.accounts.some((a) => a.username === "admin")).toBe(false);
    expect(next.accounts.some((a) => a.role === "owner")).toBe(true); // 仍留有 owner
  });

  it("username 两侧空白会被去除后再匹配", () => {
    const next = deleteAccount(base, "  bob  ");
    expect(next.accounts.map((a) => a.username)).toEqual(["admin"]);
  });
});
