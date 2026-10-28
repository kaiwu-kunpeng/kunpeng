import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import simpleGit from "simple-git";
import "../../src/server/routes/product-workspace.js";
import { dispatchModularRoute, type RouteContext } from "../../src/server/routes/registry.js";
import { isValidProductSlug } from "../../src/product/slug-guard.js";

let repo: string;
beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "kp-p0-slug-"));
  const git = simpleGit(repo);
  await git.init();
  await git.addConfig("user.email", "t@t.t");
  await git.addConfig("user.name", "t");
  writeFileSync(join(repo, "SENTINEL.md"), "keep\n");
  await git.add(".");
  await git.commit("init");
  writeFileSync(join(repo, "uncommitted.txt"), "must not be swept by add -A\n");
});
afterEach(() => { rmSync(repo, { recursive: true, force: true }); });

async function post(path: string, body: Record<string, unknown>): Promise<{ handled: boolean; payload: Record<string, unknown> }> {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]) as unknown as IncomingMessage;
  let raw = "";
  const res = { setHeader() {}, end(chunk?: string) { raw = chunk ?? ""; }, statusCode: 200 } as unknown as ServerResponse;
  const context: RouteContext = { stateDir: join(repo, ".kunpeng"), repoRoot: repo };
  const handled = await dispatchModularRoute("POST", path, req, res, context);
  return { handled: handled !== false, payload: raw ? (JSON.parse(raw) as Record<string, unknown>) : {} };
}

describe("P0-2/P0-3 回归锁：产品路由拒绝穿越 slug，父仓毫发无损（作者锁定）", () => {
  it.each(["..", "../..", "../../..", "a/../..", ".", "demo/../../x"])("slug %s 不合法", (slug) => {
    expect(isValidProductSlug(slug)).toBe(false);
  });

  it("ws-restore slug=.. → ok:false，未提交文件还在、工作区没被 add -A 卷走", async () => {
    const r = await post("/api/product/ws-restore", { projectId: "x", slug: "..", sha: "0000000" });
    expect(r.handled).toBe(true);
    expect(r.payload.ok).toBe(false);
    expect(existsSync(join(repo, "uncommitted.txt"))).toBe(true);
    const status = await simpleGit(repo).status();
    expect(status.not_added).toContain("uncommitted.txt");
    expect(status.staged).toEqual([]);
  });

  it("purge slug=../.. → ok:false，仓库与哨兵文件仍在", async () => {
    const r = await post("/api/product/purge", { projectId: "x", slug: "../.." });
    expect(r.handled).toBe(true);
    expect(r.payload.ok).toBe(false);
    expect(existsSync(join(repo, "SENTINEL.md"))).toBe(true);
    expect(existsSync(join(repo, ".git"))).toBe(true);
  });

  it("purge slug=.. → ok:false，.kunpeng 目录不被删", async () => {
    writeFileSync(join(repo, ".kunpeng-marker"), "x");
    const r = await post("/api/product/purge", { projectId: "x", slug: ".." });
    expect(r.payload.ok).toBe(false);
    expect(existsSync(join(repo, ".kunpeng-marker"))).toBe(true);
  });
});