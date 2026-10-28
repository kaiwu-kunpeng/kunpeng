import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publishLocal, readPublish } from "../../src/product/publish.js";
import { loadLoopView } from "../../src/product/loop-orchestrate.js";
import { writeLoopState } from "../../src/product/loop-store.js";
import { initState } from "../../src/product/stage-machine.js";

const NOW = 1_800_000_000_000;
let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "kp-pub-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe("publishLocal / readPublish", () => {
  it("发布写档案并可读回（注入 ensurePreview 不起真进程）", async () => {
    const rec = await publishLocal(root, "demo", NOW, {
      ensurePreview: async () => ({ url: "http://localhost:49999" }),
    });
    expect(rec.channel).toBe("local");
    expect(rec.url).toBe("http://localhost:49999");
    expect(rec.publishedAt).toBe(NOW);
    expect(existsSync(join(root, ".kunpeng", "product", "demo", "publish.json"))).toBe(true);
    expect((await readPublish(root, "demo"))?.url).toBe("http://localhost:49999");
  });
  it("未发布时 readPublish 为 undefined", async () => {
    expect(await readPublish(root, "ghost")).toBeUndefined();
  });
});

describe("loadLoopView 带出 preview/publish/qa 三态", () => {
  it("发布后视图能看到 publish 字段", async () => {
    await writeLoopState(root, initState("demo", "演示", NOW));
    await publishLocal(root, "demo", NOW, { ensurePreview: async () => ({ url: "http://localhost:49998" }) });
    const view = await loadLoopView(root, "demo");
    expect(view?.publish?.url).toBe("http://localhost:49998");
    expect(view?.preview).toBeUndefined();
    expect(view?.qa).toBeUndefined();
  });
});