import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProductKpiBaselineStore } from "../../src/evolution/kpi-baseline.js";
import type { ProductKpiSnapshot } from "../../src/evolution/product-kpi.js";

let dirs: string[] = [];
function tmp(): string { const d = mkdtempSync(join(tmpdir(), "kp-kpibl-")); dirs.push(d); return d; }
afterEach(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); dirs = []; });

describe("ProductKpiBaselineStore", () => {
  it("save 后 load 取回同一快照", async () => {
    const store = new ProductKpiBaselineStore(join(tmp(), "kpi.json"));
    const snap: ProductKpiSnapshot = { key: "autonomy", label: "自主度", value: 0.9, higherBetter: true, detail: "merged 10 · escaped 1" };
    await store.save(snap);
    expect(await store.load()).toEqual(snap);
  });
  it("文件不存在 → load 返回 null（首轮无 baseline）", async () => {
    expect(await new ProductKpiBaselineStore(join(tmp(), "nope.json")).load()).toBeNull();
  });
});
