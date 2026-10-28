import { describe, it, expect } from "vitest";
import { signSession, verifySession, findLoginAccount, addAccount, listAccounts, hashPassword, type AuthConfig } from "../../src/server/auth.js";
const SECRET="sec-x"; const NOW=1_000_000_000; const MAXAGE=7*24*3600*1000;
describe("signSession/verifySession v2", () => {
  it("签验回 accountId+profileId", () => {
    const t = signSession("acct-admin1","client-x",SECRET,NOW);
    expect(t.split(".").length).toBe(5);
    const p = verifySession(t,SECRET,NOW+1000,MAXAGE);
    expect(p?.accountId).toBe("acct-admin1"); expect(p?.profileId).toBe("client-x");
  });
  it("错secret/过期/旧3段/篡改→null", () => {
    const t = signSession("admin","home",SECRET,NOW);
    expect(verifySession(t,"bad",NOW,MAXAGE)).toBeNull();
    expect(verifySession(t,SECRET,NOW+MAXAGE+1,MAXAGE)).toBeNull();
    expect(verifySession(`admin.${NOW}.dead`,SECRET,NOW,MAXAGE)).toBeNull();
    const ps = t.split("."); ps[2]="client-x";
    expect(verifySession(ps.join("."),SECRET,NOW,MAXAGE)).toBeNull();
  });
});
describe("findLoginAccount/addAccount/listAccounts", () => {
  const salt="s1"; const hash=hashPassword("pw",salt);
  const base: AuthConfig = { secret:SECRET, accounts:[{ username:"admin", salt, hash, profileId:"home", role:"owner", updatedAt:0 }] };
  it("findLoginAccount 命中/不中", () => {
    expect(findLoginAccount(base,{username:"admin",password:"pw"})?.profileId).toBe("home");
    expect(findLoginAccount(base,{username:"admin",password:"WRONG"})).toBeNull();
    expect(findLoginAccount(base,{username:"ghost",password:"pw"})).toBeNull();
  });
  it("addAccount 默认 member/绑profile/哈希/不可变", () => {
    const out = addAccount(base,{username:"admin1",password:"p2",profileId:"client-x",salt:"s2",now:5});
    expect(out.accounts).toHaveLength(2); expect(base.accounts).toHaveLength(1);
    const a = out.accounts.find(x=>x.username==="admin1")!;
    expect(a.role).toBe("member"); expect(a.profileId).toBe("client-x"); expect(a.hash).not.toBe("p2");
  });
  it("重名/空名→抛", () => {
    expect(()=>addAccount(base,{username:"admin",password:"x",profileId:"home",salt:"s",now:1})).toThrow(/已存在/);
    expect(()=>addAccount(base,{username:" ",password:"x",profileId:"home",salt:"s",now:1})).toThrow();
  });
  it("listAccounts 脱敏", () => {
    expect(listAccounts(base)).toEqual([{username:"admin",profileId:"home",role:"owner",hostCeiling:"full"}]);
    expect(JSON.stringify(listAccounts(base))).not.toContain(hash);
  });
});