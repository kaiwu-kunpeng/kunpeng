import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { createProduct, deleteProduct } from "../../src/product/registry-service.js";
import { readActivity } from "../../src/product/activity-log.js";

async function tmp(): Promise<string> { return mkdtemp(join(tmpdir(), "kp-actwire-")); }

describe("产品创建/删除记活动", () => {
  it("createProduct(scratch) 记新建事件", async () => {
    const root = await tmp();
    const e = await createProduct(root, "我的产品", 100);
    const acts = await readActivity(root, e.slug);
    expect(acts.length).toBe(1);
    expect(acts[0].kind).toBe("create");
    expect(acts[0].summary).toContain("新建产品");
    await rm(root, { recursive: true, force: true });
  });

  it("createProduct(copy-ref) 记「从参考产品生成」", async () => {
    const root = await tmp();
    const e = await createProduct(root, "抄来的", 1, "copy-ref");
    const acts = await readActivity(root, e.slug);
    expect(acts[0].summary).toContain("从参考产品生成");
    await rm(root, { recursive: true, force: true });
  });

  it("deleteProduct 记删除事件", async () => {
    const root = await tmp();
    const e = await createProduct(root, "待删", 1);
    await deleteProduct(root, e.slug, "测试", 2);
    const acts = await readActivity(root, e.slug);
    expect(acts[0].kind).toBe("delete");
    expect(acts[0].summary).toContain("测试");
    await rm(root, { recursive: true, force: true });
  });
});