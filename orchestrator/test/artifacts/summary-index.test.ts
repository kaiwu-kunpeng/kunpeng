import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore } from "../../src/artifacts/store.js";

describe("5a ArtifactStore 摘要索引", () => {
  it("write 维护索引,listSummaries 读出摘要,缺失时 fallback 重建", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "kp-artidx-")), "artifacts");
    const store = new ArtifactStore(dir);

    await store.write({ kind: "spec", id: "a1", status: "draft", body: "摘要一\n更多内容", meta: {} });
    await store.write({ kind: "plan", id: "a2", status: "verified", body: "摘要二", meta: {} });

    const sums = await store.listSummaries();
    expect(sums.length).toBe(2);
    const a1 = sums.find((s) => s.id === "a1");
    expect(a1?.summary).toBe("摘要一");
    expect(a1?.kind).toBe("spec");
    expect(a1?.status).toBe("draft");

    // 索引文件已生成
    expect(existsSync(join(dir, "_summary-index.json"))).toBe(true);

    // kind 过滤
    expect((await store.listSummaries("plan")).length).toBe(1);

    // 删索引 → fallback 全量重建,结果不变
    rmSync(join(dir, "_summary-index.json"));
    const rebuilt = await store.listSummaries();
    expect(rebuilt.length).toBe(2);
    expect(existsSync(join(dir, "_summary-index.json"))).toBe(true);
  });

  it("listSummaries 结果与 list() 的 id 集一致", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "kp-artidx2-")), "artifacts");
    const store = new ArtifactStore(dir);
    await store.write({ kind: "task", id: "t1", status: "draft", body: "任务", meta: {} });
    const full = await store.list();
    const sums = await store.listSummaries();
    expect(sums.map((s) => s.id).sort()).toEqual(full.map((a) => a.id).sort());
  });
});