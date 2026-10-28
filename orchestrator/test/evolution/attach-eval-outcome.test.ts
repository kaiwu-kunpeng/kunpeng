import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore } from "../../src/artifacts/store.js";
import { attachEvalOutcome } from "../../src/evolution/eval-deps.js";
import { classifyEvalOutcome } from "../../src/evolution/eval-outcome.js";

describe("attachEvalOutcome", () => {
  it("tested / downgraded 两态写进 meta.proposal", async () => {
    const store = new ArtifactStore(mkdtempSync(join(tmpdir(), "kp-evalout-")));
    await store.write({ kind: "proposal", id: "p1", status: "draft", body: "x", meta: { proposal: { channel: "patrol" } } });

    await attachEvalOutcome(store, "p1", classifyEvalOutcome({ ok: true }));
    let art = await store.read("p1");
    let pm = (art.meta as { proposal?: { evidenceState?: string; evidenceReason?: string; channel?: string } }).proposal;
    expect(pm?.evidenceState).toBe("tested");
    expect(pm?.channel).toBe("patrol");

    await attachEvalOutcome(store, "p1", classifyEvalOutcome({ ok: false, error: new Error("boom") }));
    art = await store.read("p1");
    pm = (art.meta as { proposal?: { evidenceState?: string; evidenceReason?: string } }).proposal;
    expect(pm?.evidenceState).toBe("downgraded");
    expect(pm?.evidenceReason).toBe("boom");
  });
});