import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore } from "../../src/artifacts/store.js";
import { recordArtifactDecision } from "../../src/server/decision-audit.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kp-decision-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("artifact 裁决署名 + 审计行（作者锁定）", () => {
  it("批准：meta.decidedBy 记 by/via/who/at/decision；审计文件逐行追加", async () => {
    const store = new ArtifactStore(join(dir, "artifacts"));
    await store.write({ kind: "proposal", id: "prop-1", status: "draft", body: "x", meta: {} });
    await store.transition("prop-1", "approved");
    const audit = join(dir, "audit", "decisions.jsonl");
    const rec = await recordArtifactDecision(store, audit, { id: "prop-1", decision: "approved", via: "cockpit", who: "admin", projectId: "proj-a", now: () => 1234 });
    expect(rec).toEqual({ by: "human", via: "cockpit", who: "admin", at: 1234, decision: "approved" });
    expect((await store.read("prop-1")).meta.decidedBy).toEqual(rec);
    await store.write({ kind: "release", id: "rel-1", status: "draft", body: "y", meta: {} });
    await store.transition("rel-1", "rolled-back");
    await recordArtifactDecision(store, audit, { id: "rel-1", decision: "rejected", via: "cockpit", now: () => 1235 });
    const lines = readFileSync(audit, "utf8").trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ at: 1234, kind: "proposal", id: "prop-1", decision: "approved", by: "human", via: "cockpit", who: "admin", projectId: "proj-a" });
    expect(lines[1]).toMatchObject({ at: 1235, kind: "release", id: "rel-1", decision: "rejected", by: "human", via: "cockpit" });
    expect(lines[1]).not.toHaveProperty("who");
  });

  it("未知 artifact → 抛错，不写审计行", async () => {
    const store = new ArtifactStore(join(dir, "artifacts"));
    const audit = join(dir, "audit", "decisions.jsonl");
    await expect(recordArtifactDecision(store, audit, { id: "nope", decision: "approved", via: "cockpit" })).rejects.toThrow();
    expect(() => readFileSync(audit, "utf8")).toThrow();
  });
});