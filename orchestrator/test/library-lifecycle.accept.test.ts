import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setEntryMeta, readMeta, applyMeta } from "../src/library/meta.js";
import { buildLibraryIndex, searchLibrary, scanSpecs } from "../src/library/scan.js";

describe("资料层生命周期(作者验收)", () => {
  it("overlay 往返 + applyMeta 计算 needsReview", async () => {
    const state = await mkdtemp(join(tmpdir(), "kp-meta-"));
    await setEntryMeta(state, "e1", { audience: "agent", trigger: "写 spec 前看", verifyUntil: 100 });
    const meta = await readMeta(state);
    expect(meta.e1.trigger).toContain("spec");
    const entries = [{ id: "e1", type: "doc", title: "t", status: "active", tags: [], sourcePath: "/x", updatedAt: 1 }] as never;
    const out = applyMeta(entries, meta, 200);
    expect(out[0].needsReview).toBe(true);
    expect(out[0].audience).toBe("agent");
    const fresh = applyMeta(entries, meta, 50);
    expect(fresh[0].needsReview).toBe(false);
  });

  it("buildLibraryIndex 套 overlay 且 searchLibrary 支持 needsReview/audience 过滤", async () => {
    const specs = await mkdtemp(join(tmpdir(), "kp-meta-s-"));
    const state = await mkdtemp(join(tmpdir(), "kp-meta-st-"));
    await writeFile(join(specs, "a.md"), "# 方案甲\n");
    const first = await scanSpecs(specs);
    await setEntryMeta(state, first[0].id, { verifyUntil: 1, audience: "agent" });
    const { entries } = await buildLibraryIndex({ specsDir: specs, stateDir: state });
    const stale = searchLibrary(entries, "", { needsReview: true } as never);
    expect(stale.length).toBe(1);
    expect(searchLibrary(entries, "", { audience: "agent" } as never).length).toBe(1);
    expect(searchLibrary(entries, "", { audience: "human" } as never).length).toBe(0);
  });
});