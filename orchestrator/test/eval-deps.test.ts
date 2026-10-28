import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore } from "../src/artifacts/store.js";
import { attachEvidence } from "../src/evolution/eval-deps.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kp-eval-deps-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

test("attachEvidence writes proposal evidence without changing existing artifact fields", async () => {
  const store = new ArtifactStore(dir);
  const id = "proposal-1";
  const changes = [{ target: "conventions", text: "x", source: "e" }];

  await store.write({
    kind: "proposal",
    id,
    status: "draft",
    body: "body",
    meta: {
      proposal: {
        changes,
      },
    },
  });
  const before = await store.read(id);

  await attachEvidence(store, id, {
    holdoutPassK: 0.9,
    costPerResolvedTask: 1,
    baseline: { holdoutPassK: 0.9 },
  });

  const back = await store.read(id);
  const meta = back.meta as {
    proposal?: {
      changes?: unknown;
      evidence?: {
        holdoutPassK?: number;
        costPerResolvedTask?: number;
        baseline?: { holdoutPassK?: number };
      };
    };
  };

  expect(meta.proposal?.evidence?.holdoutPassK).toBe(0.9);
  expect(meta.proposal?.evidence?.costPerResolvedTask).toBe(1);
  expect(meta.proposal?.evidence?.baseline?.holdoutPassK).toBe(0.9);
  expect(meta.proposal?.changes).toEqual(changes);
  expect(back.kind).toBe(before.kind);
  expect(back.status).toBe(before.status);
  expect(back.body).toBe(before.body);
});
