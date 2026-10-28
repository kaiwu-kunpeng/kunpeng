import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  productWorkspaceDir,
  ensureWorkspace,
  commitWorkspaceVersion,
  listWorkspaceVersions,
  restoreWorkspaceVersion,
} from "../../src/product/workspace.js";

describe("产品独立工作区", () => {
  let root: string;
  const slug = "demo";
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), "kp-ws-")); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it("ensureWorkspace 幂等建仓 + 宿主 gitignore 追加一次", async () => {
    const ws = await ensureWorkspace(root, slug);
    expect(ws).toBe(productWorkspaceDir(root, slug));
    expect(existsSync(join(ws, ".git"))).toBe(true);
    await ensureWorkspace(root, slug);
    const ignore = readFileSync(join(root, ".gitignore"), "utf8");
    expect(ignore.split("\n").filter((l) => l.trim() === "products/").length).toBe(1);
  });

  it("提交→列版本→追加式恢复全链", async () => {
    const ws = await ensureWorkspace(root, slug);
    writeFileSync(join(ws, "index.html"), "<h1>v1</h1>");
    const v1 = await commitWorkspaceVersion(root, slug, "第一版");
    expect(v1).toBeTruthy();
    expect(await commitWorkspaceVersion(root, slug, "无变更")).toBeUndefined();

    writeFileSync(join(ws, "index.html"), "<h1>v2</h1>");
    const v2 = await commitWorkspaceVersion(root, slug, "第二版");
    expect(v2).toBeTruthy();

    const versions = await listWorkspaceVersions(root, slug);
    expect(versions[0].sha).toBe(v2);
    expect(versions[0].message).toBe("第二版");
    expect(versions[1].sha).toBe(v1);

    const restored = await restoreWorkspaceVersion(root, slug, v1 as string);
    expect(restored).toBeTruthy();
    expect(readFileSync(join(ws, "index.html"), "utf8")).toBe("<h1>v1</h1>");
    const after = await listWorkspaceVersions(root, slug);
    expect(after.length).toBeGreaterThan(versions.length);
    expect(after.some((v) => v.sha === v2)).toBe(true);
  });

  it("fail-safe：无仓列空、无仓提交 undefined、坏 sha 恢复 undefined", async () => {
    expect(await listWorkspaceVersions(root, "ghost")).toEqual([]);
    expect(await commitWorkspaceVersion(root, "ghost", "x")).toBeUndefined();
    await ensureWorkspace(root, slug);
    expect(await restoreWorkspaceVersion(root, slug, "deadbeef")).toBeUndefined();
  });
});