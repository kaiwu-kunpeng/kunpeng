import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os"; import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { readProfileRegistry, writeProfileRegistry, assertProjectInProfile, isProjectInProfile, type ProfileProjectEntry } from "../../src/project/registry-profile.js";
const sample: ProfileProjectEntry[] = [{ id:"acme-shop", name:"AcmeShop", repoPath:"/r/p", registeredAt:1 }];
describe("读写", () => {
  it("write 后 read 取回", async () => {
    const dir = await mkdtemp(join(tmpdir(),"kp-reg-")); const pp = join(dir,"profiles","home","projects.json");
    writeProfileRegistry(pp, sample); expect(readProfileRegistry(pp)).toEqual(sample); await rm(dir,{recursive:true,force:true});
  });
  it("缺文件→[]，脏条目过滤", () => {
    expect(readProfileRegistry("x", () => { throw new Error("ENOENT"); })).toEqual([]);
    expect(readProfileRegistry("x", () => JSON.stringify({projects:[{name:"bad"}, sample[0]]}))).toEqual(sample);
  });
});
describe("授权门", () => {
  it("属于→不抛/true；不属→抛 FORBIDDEN_PROJECT/false", () => {
    expect(() => assertProjectInProfile("acme-shop", sample)).not.toThrow();
    expect(isProjectInProfile("acme-shop", sample)).toBe(true);
    expect(() => assertProjectInProfile("secret", sample)).toThrow(/FORBIDDEN_PROJECT:secret/);
    expect(isProjectInProfile("secret", sample)).toBe(false);
  });
});
