import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { upsertProduct, listProducts } from "../src/product/registry.js";
import { abandonFlow } from "../src/runtime/flow-abandon.js";
import { FlowTracker } from "../src/runtime/flowstate.js";

function mkEntry(slug: string) {
  return { slug, title: slug, status: "active" as const, createdAt: 1, updatedAt: 1 };
}

describe("审计修复D 存储原子/容错", () => {
  it("product 并发 upsert 不丢产品", async () => {
    const repo = mkdtempSync(join(tmpdir(), "kp-prod-d-"));
    try {
      await upsertProduct(repo, mkEntry("p1"));
      await Promise.all([upsertProduct(repo, mkEntry("p2")), upsertProduct(repo, mkEntry("p3"))]);
      const all = await listProducts(repo, { includeArchived: true });
      expect(all.map((p) => p.slug).sort()).toEqual(["p1", "p2", "p3"]);
    } finally { rmSync(repo, { recursive: true, force: true }); }
  });

  it("flow-abandon 写出 rolled-back 状态", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kp-abandon-d-"));
    try {
      const ft = new FlowTracker(dir);
      await ft.start("f1", "需求");
      const r = await abandonFlow(dir, "f1");
      expect(r.ok).toBe(true);
      const s = await ft.read("f1");
      expect(s?.status).toBe("rolled-back");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("FlowTracker.list 单坏档不清空整表", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kp-list-d-"));
    try {
      const ft = new FlowTracker(dir);
      await ft.start("good1", "r1");
      await ft.start("good2", "r2");
      writeFileSync(join(dir, "bad.json"), "{ not valid json");
      const flows = await ft.list();
      expect(flows.length).toBe(2);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});