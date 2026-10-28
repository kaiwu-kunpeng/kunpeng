import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildLibraryIndex, scanSpecs, searchLibrary } from "../src/library/scan.js";
import { registerModularRoute, dispatchModularRoute, listModularRoutes } from "../src/server/routes/registry.js";

describe("资料层索引(作者验收)", () => {
  it("scanSpecs 提取标题/状态并跳过 logs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kp-lib-"));
    await writeFile(join(dir, "a.md"), "# 方案A\n正文");
    await mkdir(join(dir, "archive"), { recursive: true });
    await writeFile(join(dir, "archive", "old.md"), "# 旧方案\n");
    await mkdir(join(dir, "logs"), { recursive: true });
    await writeFile(join(dir, "logs", "x.log.md"), "# 不该出现\n");
    const entries = await scanSpecs(dir);
    expect(entries.length).toBe(2);
    const a = entries.find((e) => e.title === "方案A");
    expect(a?.status).toBe("active");
    expect(a?.type).toBe("spec");
    expect(entries.find((e) => e.title === "旧方案")?.status).toBe("archived");
  });

  it("buildLibraryIndex 聚合并落盘,searchLibrary 过滤", async () => {
    const specs = await mkdtemp(join(tmpdir(), "kp-lib-s-"));
    const docs = await mkdtemp(join(tmpdir(), "kp-lib-d-"));
    const state = await mkdtemp(join(tmpdir(), "kp-lib-st-"));
    await writeFile(join(specs, "s1.md"), "# 检索目标Alpha\n");
    await writeFile(join(docs, "d1.html"), "<html><head><title>文档Beta</title></head><body></body></html>");
    const { entries, indexPath } = await buildLibraryIndex({ specsDir: specs, docsDir: docs, skillsRoot: join(state, "nope"), stateDir: state });
    expect(entries.length).toBe(2);
    const onDisk = JSON.parse(await readFile(indexPath, "utf8")) as unknown[];
    expect(onDisk.length).toBe(2);
    expect(searchLibrary(entries, "alpha").length).toBe(1);
    expect(searchLibrary(entries, "", { type: "doc" })[0].title).toBe("文档Beta");
  });

  it("路由注册表:注册/分发/未命中", async () => {
    let hit = "";
    registerModularRoute({ method: "GET", path: "/api/__t", handle: async (_q, res, url) => { hit = url; (res as { end(b?: string): void }).end("ok"); } });
    expect(listModularRoutes().some((r) => r.path === "/api/__t")).toBe(true);
    const fakeRes = { end: () => {}, setHeader: () => {}, writeHead: () => {} };
    const ok = await dispatchModularRoute("GET", "/api/__t?x=1", {} as never, fakeRes as never, { repoRoot: "/", stateDir: "/" });
    expect(ok).toBe(true);
    expect(hit).toContain("/api/__t");
    expect(await dispatchModularRoute("GET", "/api/__none", {} as never, fakeRes as never, { repoRoot: "/", stateDir: "/" })).toBe(false);
  });
});