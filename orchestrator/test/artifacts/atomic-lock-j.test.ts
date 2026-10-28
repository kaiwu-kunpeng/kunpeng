import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore } from "../../src/artifacts/store.js";

describe("审计修复J artifacts 原子+锁", () => {
  it("并发 patchMeta 不丢字段", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kp-art-j-"));
    try {
      const store = new ArtifactStore(dir);
      await store.write({ kind: "spec", id: "s1", status: "draft", body: "# R\nbuild X", meta: {} });
      await Promise.all([
        store.patchMeta("s1", { x: 1 }),
        store.patchMeta("s1", { y: 2 }),
      ]);
      const back = await store.read("s1");
      expect(back.meta.x).toBe(1);
      expect(back.meta.y).toBe(2);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("write→read 正文 roundtrip(回归)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kp-art-j2-"));
    try {
      const store = new ArtifactStore(dir);
      await store.write({ kind: "spec", id: "s2", status: "draft", body: "# Req\nbuild Y", meta: { a: 1 } });
      const back = await store.read("s2");
      expect(back.body).toContain("build Y");
      expect(back.status).toBe("draft");
      expect(back.meta.a).toBe(1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});