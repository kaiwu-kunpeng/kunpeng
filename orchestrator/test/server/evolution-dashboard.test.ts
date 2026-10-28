import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ArtifactStore } from "../../src/artifacts/store.js";
import { collectState } from "../../src/server/state.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kp-evolution-dashboard-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

test("collectState builds health dashboard from real proposal evidence", async () => {
  const store = new ArtifactStore(join(dir, ".kunpeng", "artifacts"));

  await store.write({
    kind: "proposal",
    id: "proposal-a",
    status: "draft",
    body: "proposal A",
    meta: {
      proposal: {
        changes: [],
        evidence: { holdoutPassK: 0.8, costPerResolvedTask: 1, baseline: { holdoutPassK: 0.6 } },
      },
    },
  });
  await store.write({
    kind: "proposal",
    id: "proposal-b",
    status: "approved",
    body: "proposal B",
    meta: {
      proposal: {
        changes: [],
        evidence: { holdoutPassK: 0.9, costPerResolvedTask: 1, baseline: { holdoutPassK: 0.85 } },
      },
    },
  });

  const state = await collectState(store, dir);

  expect(state.evolution?.dashboard).toBeDefined();
  expect(state.evolution!.dashboard!.holdoutPassAt1).toBe(0.9);
  expect(state.evolution!.dashboard!.lastDelta).toBeCloseTo(0.05);
  expect(state.evolution!.dashboard!.archiveSize).toBe(2);
  expect(state.evolution!.dashboard!.approvedCount).toBe(1);
  expect(state.evolution!.dashboard!.holdoutCount).toBe(0);
  expect(state.evolution!.dashboard!.optimizationCount).toBe(0);
  expect(state.evolution!.dashboard!.series).toHaveLength(2);
  expect(state.evolution!.dashboard!.series[0]).toMatchObject({ id: "proposal-a", pass: 0.8 });
  expect(state.evolution!.dashboard!.series[0].delta).toBeCloseTo(0.2);
  expect(state.evolution!.dashboard!.series[1]).toMatchObject({ id: "proposal-b", pass: 0.9 });
  expect(state.evolution!.dashboard!.series[1].delta).toBeCloseTo(0.05);

  const proposalA = state.evolution!.proposals.find((proposal) => proposal.id === "proposal-a");
  const proposalB = state.evolution!.proposals.find((proposal) => proposal.id === "proposal-b");
  expect(proposalA?.baselinePassK).toBe(0.6);
  expect(proposalA?.delta).toBeCloseTo(0.2);
  expect(proposalB?.baselinePassK).toBe(0.85);
  expect(proposalB?.delta).toBeCloseTo(0.05);
});

test("dashboard skips proposals without holdout evidence and tolerates an empty archive", async () => {
  const store = new ArtifactStore(join(dir, ".kunpeng", "artifacts"));

  await store.write({
    kind: "proposal",
    id: "proposal-without-evidence",
    status: "draft",
    body: "proposal without evidence",
    meta: { proposal: { changes: [] } },
  });

  const stateWithProposal = await collectState(store, dir);

  expect(stateWithProposal.evolution?.dashboard).toBeDefined();
  expect(stateWithProposal.evolution!.dashboard!.archiveSize).toBe(1);
  expect(stateWithProposal.evolution!.dashboard!.series).toEqual([]);
  expect(stateWithProposal.evolution!.dashboard!.holdoutPassAt1).toBeUndefined();
  expect(stateWithProposal.evolution!.dashboard!.lastDelta).toBeUndefined();

  const emptyStore = new ArtifactStore(join(dir, ".kunpeng", "empty-artifacts"));
  const emptyState = await collectState(emptyStore, dir);

  expect(emptyState.evolution?.dashboard).toBeDefined();
  expect(emptyState.evolution!.dashboard!.archiveSize).toBe(0);
  expect(emptyState.evolution!.dashboard!.series).toEqual([]);
});
