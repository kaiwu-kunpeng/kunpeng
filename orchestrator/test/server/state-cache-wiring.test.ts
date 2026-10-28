import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore } from "../../src/artifacts/store.js";
import { collectStateCached, __clearStateCache } from "../../src/server/state.js";

describe("#3 单项目状态采集缓存", () => {
  it("TTL 内二次调用命中缓存(返回同一引用),清缓存后重新采集", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "kp-state-cache-"));
    const store = new ArtifactStore(join(tmp, ".kunpeng", "artifacts"));

    __clearStateCache();
    const r1 = await collectStateCached(store, tmp);
    const r2 = await collectStateCached(store, tmp);
    expect(r2).toBe(r1); // TTL(3s)内命中,同一对象引用

    __clearStateCache();
    const r3 = await collectStateCached(store, tmp);
    expect(r3).not.toBe(r1); // 清缓存后重新采集,是新对象
  });
});