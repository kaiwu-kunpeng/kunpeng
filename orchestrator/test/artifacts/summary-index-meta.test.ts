import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore } from "../../src/artifacts/store.js";
import { collectState } from "../../src/server/state.js";

describe("5b 摘要索引存 meta + collectState 走索引", () => {
  it("listSummaries 每条带 meta", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "kp-idxmeta-")), "artifacts");
    const store = new ArtifactStore(dir);
    await store.write({ kind: "spec", id: "a1", status: "draft", body: "正文", meta: { owner: "me", n: 3 } });
    const sums = await store.listSummaries();
    expect(sums.length).toBe(1);
    expect(sums[0].meta).toEqual({ owner: "me", n: 3 });
    expect(sums[0].summary).toBe("正文");
  });

  it("collectState 用索引后 artifacts 分组与 statusCounts 正确", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "kp-cs-idx-"));
    const store = new ArtifactStore(join(tmp, ".kunpeng", "artifacts"));
    await store.write({ kind: "spec", id: "s1", status: "draft", body: "规格一", meta: {} });
    await store.write({ kind: "plan", id: "p1", status: "verified", body: "方案一", meta: {} });

    const state = await collectState(store, tmp);
    const specItems = state.artifacts.spec ?? [];
    const planItems = state.artifacts.plan ?? [];
    expect(specItems.some((x) => x.id === "s1" && x.summary === "规格一")).toBe(true);
    expect(planItems.some((x) => x.id === "p1")).toBe(true);
    expect(state.statusCounts.draft).toBe(1);
    expect(state.statusCounts.verified).toBe(1);
  });
});