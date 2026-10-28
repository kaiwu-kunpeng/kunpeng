import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ArtifactStore } from "../src/artifacts/store.js";
import { collectState } from "../src/server/state.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kp-dashboard-evolution-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

test("collectState aggregates read-only evolution truth from real proposal artifacts", async () => {
  const store = new ArtifactStore(join(dir, ".kunpeng", "artifacts"));

  await store.write({
    kind: "proposal",
    id: "proposal-approved",
    status: "approved",
    body: "\napproved summary\nsecond line",
    meta: { proposal: { changes: [] } },
  });
  await store.write({
    kind: "proposal",
    id: "proposal-with-evidence",
    status: "draft",
    body: "\n\nwith evidence summary\nmore detail",
    meta: {
      proposal: {
        changes: [],
        evidence: { holdoutPassK: 0.8, costPerResolvedTask: 1000 },
      },
    },
  });
  await store.write({
    kind: "proposal",
    id: "proposal-without-evidence",
    status: "draft",
    body: "without evidence summary",
    meta: { proposal: { changes: [] } },
  });

  const state = await collectState(store, dir);

  expect(state.evolution).toBeDefined();
  expect(state.evolution!.proposals).toHaveLength(3);
  expect(state.evolution!.approvedCount).toBe(1);
  expect(state.evolution!.pendingCount).toBe(2);
  expect(state.evolution!.lastRunText).toBe(state.patrol.lastRunText);

  const proposalStatuses = state.evolution!.proposals.map((proposal) => proposal.status);
  expect(proposalStatuses.slice(0, 2)).toEqual(["draft", "draft"]);
  expect(proposalStatuses[2]).toBe("approved");

  const withEvidence = state.evolution!.proposals.find((proposal) => proposal.id === "proposal-with-evidence");
  expect(withEvidence).toBeDefined();
  expect(withEvidence!.summary).toBe("with evidence summary");
  expect(withEvidence!.hasEvidence).toBe(true);
  expect(withEvidence!.holdoutPassK).toBe(0.8);
  expect(withEvidence!.costPerResolvedTask).toBe(1000);

  const withoutEvidence = state.evolution!.proposals.find((proposal) => proposal.id === "proposal-without-evidence");
  expect(withoutEvidence).toBeDefined();
  expect(withoutEvidence!.hasEvidence).toBe(false);
  expect(withoutEvidence!.holdoutPassK).toBeUndefined();

  expect(typeof state.evolution!.regression.holdout).toBe("number");
  expect(typeof state.evolution!.regression.optimization).toBe("number");
  expect(state.evolution!.regression.holdout).toBeGreaterThanOrEqual(0);
  expect(state.evolution!.regression.optimization).toBeGreaterThanOrEqual(0);
  expect(state.evolution!.regression).toEqual({ holdout: 0, optimization: 0 });
});
