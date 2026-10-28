import { clientSource } from "./helpers/client-source.js";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { createAuthzRegistry } from "../src/server/localfs/authz-registry.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const clientSrc = clientSource();
const workspaceEndpointsSrc = readFileSync(join(root, "src", "server", "workspace-endpoints.ts"), "utf8");

describe("锁语义+账号隔离(作者验收)", () => {
  it("锁 chip 带文字语义与全程锁定话术", () => {
    expect(clientSrc.includes("敏感·不进知识库") || clientSrc.includes("\\u654F\\u611F\\u00B7\\u4E0D\\u8FDB\\u77E5\\u8BC6\\u5E93")).toBe(true);
    expect(clientSrc.includes("直到手动解锁") || clientSrc.includes("\\u76F4\\u5230\\u624B\\u52A8\\u89E3\\u9501")).toBe(true);
    expect(clientSrc.includes("分叉") || clientSrc.includes("\\u5206\\u53C9")).toBe(true);
  });
  it("授权目录带账号标注且 handle key 掺账号", () => {
    expect(clientSrc.includes("账号") || clientSrc.includes("\\u8D26\\u53F7")).toBe(true);
    expect(clientSrc).toContain("::");
  });
  it("authz-registry 按账号强校验", () => {
    const reg = createAuthzRegistry();
    reg.register({ conv: "c1", clientId: "k1", dirName: "d", origin: "o", username: "alice", ts: 1 });
    expect(reg.matches("c1", "k1", "alice")).toBe(true);
    expect(reg.matches("c1", "k1", "bob")).toBe(false);
    expect(reg.matches("c1", "k1")).toBe(true);
  });
  it("workspace-endpoints 直接校验 authz 与 username", () => {
    expect(workspaceEndpointsSrc).toMatch(/authz\.matches\(/);
    expect(workspaceEndpointsSrc).toMatch(/owner\.username\s*!==\s*\(req\.username/);
  });
});
