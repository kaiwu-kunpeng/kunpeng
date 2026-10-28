import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore } from "../src/artifacts/store.js";
import { runPatrol } from "../src/loop/patrol.js";
import type { EvalDeps } from "../src/evolution/eval-runner.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kp-patrol-evidence-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function seedExperience(store: ArtifactStore, id = "e1") {
  await store.write({
    kind: "experience",
    id,
    status: "draft",
    body: "",
    meta: { sourceFlow: `flow-${id}`, outcome: "verified", proposedRuleChange: { target: "conventions", text: `rule from ${id}` } },
  });
}

function proposalMeta(artifact: Awaited<ReturnType<ArtifactStore["read"]>>) {
  return artifact.meta as {
    proposal?: {
      evidence?: {
        holdoutPassK?: number;
      };
    };
  };
}

test("attaches holdout evidence to a newly created draft proposal when evalDeps is injected", async () => {
  const store = new ArtifactStore(join(dir, ".kunpeng", "artifacts"));
  await seedExperience(store);
  let listHoldoutCalled = false;
  const evalDeps: EvalDeps = {
    listHoldout: async () => {
      listHoldoutCalled = true;
      return [];
    },
    runAcceptance: async () => {
      throw new Error("runAcceptance must not be called for empty holdout");
    },
    cwd: dir,
    now: () => 456,
  };

  const result = await runPatrol({ store, evalDeps, now: () => 123 });

  expect(result.proposalId).toBeTruthy();
  expect(result.evidenceAttached).toBe(true);
  expect(listHoldoutCalled).toBe(true);

  const proposal = await store.read(result.proposalId!);
  expect(proposal.kind).toBe("proposal");
  expect(proposal.status).toBe("draft");
  expect(proposalMeta(proposal).proposal?.evidence).toBeTruthy();
  expect(proposalMeta(proposal).proposal?.evidence?.holdoutPassK).toBe(0);
});

test("keeps draft proposal creation compatible when evalDeps is not injected", async () => {
  const store = new ArtifactStore(join(dir, ".kunpeng", "artifacts"));
  await seedExperience(store);

  const result = await runPatrol({ store, now: () => 123 });

  expect(result.proposalId).toBeTruthy();
  expect(result.evidenceAttached).toBeFalsy();

  const proposal = await store.read(result.proposalId!);
  expect(proposal.kind).toBe("proposal");
  expect(proposal.status).toBe("draft");
  expect(proposalMeta(proposal).proposal?.evidence).toBeUndefined();
});