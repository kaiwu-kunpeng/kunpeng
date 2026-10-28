import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startProductRun } from "../../src/product/loop-orchestrate.js";
import { readInterview, readInterviewFor } from "../../src/product/store.js";
import { productSlug } from "../../src/product/artifacts.js";

const NOW = 1_800_000_000_000;
let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "kp-startrun-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe("startProductRun（per-slug 后）", () => {
  it("新建产品即启动 DEFINE 访谈并给出第一问", async () => {
    const r = await startProductRun(root, "一句话生成周报工具", NOW);
    expect(r.product.slug.length).toBeGreaterThan(0);
    expect(r.question).toBeTruthy();
    const session = await readInterview(root);
    expect(session?.status).toBe("in-progress");
    expect(session?.idea).toBe("一句话生成周报工具");
  });
  it("并行两个产品：都有各自访谈，新建者成为活动产品", async () => {
    await startProductRun(root, "第一个产品", NOW);
    const r2 = await startProductRun(root, "第二个产品", NOW + 1);
    expect(r2.question).toBeTruthy();
    expect((await readInterview(root))?.idea).toBe("第二个产品");
    expect((await readInterviewFor(root, productSlug("第一个产品")))?.idea).toBe("第一个产品");
  });
});