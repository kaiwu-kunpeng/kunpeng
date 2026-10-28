import { describe, it, expect } from "vitest";
import { parseDotenv, resolveActiveProfile, profileDir, sharedDir, kunpengStateDir } from "../../src/project/profile.js";
describe("parseDotenv", () => {
  it("解析/跳注释/去引号", () => {
    expect(parseDotenv('# c\nGITHUB_TOKEN=abc\n\nVERCEL_TOKEN="x y"\n')).toEqual({ GITHUB_TOKEN:"abc", VERCEL_TOKEN:"x y" });
  });
});
describe("resolveActiveProfile", () => {
  it("空 id 抛错", () => { expect(() => resolveActiveProfile("  ")).toThrow(); });
  it("缺凭证→空对象 + 路径正确", () => {
    const ap = resolveActiveProfile("home", () => { throw new Error("ENOENT"); });
    expect(ap.id).toBe("home"); expect(ap.credentialsEnv).toEqual({});
    expect(ap.projectsPath.endsWith("profiles/home/projects.json")).toBe(true);
  });
  it("有凭证→注入", () => {
    expect(resolveActiveProfile("client-x", () => "NEON_DATABASE_URL=postgres://h/db").credentialsEnv.NEON_DATABASE_URL).toBe("postgres://h/db");
  });
});
describe("路径分流", () => {
  it("profileDir 在 profiles/ 下、sharedDir 在 shared/ 下", () => {
    expect(profileDir("home").includes("/profiles/home")).toBe(true);
    expect(sharedDir().endsWith("/shared")).toBe(true);
    expect(profileDir("home").startsWith(kunpengStateDir())).toBe(true);
  });
});
