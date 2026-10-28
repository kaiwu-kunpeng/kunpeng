import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ArtifactStore } from "../src/artifacts/store.js";
import type { Artifact } from "../src/artifacts/types.js";
import { applyApprovedProposals, evolutionProposalFromArtifact, type ApplyDeps, type EvolutionProposal } from "../src/evolution/apply.js";
import type { RoutedChanges } from "../src/evolution/route.js";
import {
  buildProposal,
  hasApplicableEvidence,
  persistProposal,
  type ProposedChange,
} from "../src/loop/self-evolution.js";

let dir: string;
let conventionsPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kp-evidence-"));
  conventionsPath = join(dir, "conventions.md");
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

const conv = (text = "约定更新"): ProposedChange => ({ target: "conventions", text, source: "exp-conv" });
const upgrade = (text = "升级工具"): ProposedChange => ({ target: "upgrade", text, source: "exp-up" });
const exp = (id: string, proposedRuleChange?: unknown): Artifact =>
  ({ kind: "experience", id, status: "draft", body: "", meta: proposedRuleChange ? { sourceFlow: `flow-${id}`, outcome: "verified", proposedRuleChange } : {} });

function depsFor(routeResult: RoutedChanges, auditSafe = true): ApplyDeps {
  return {
    conventionsPath,
    route: vi.fn(() => routeResult),
    applyConventions: vi.fn(async () => ({ appended: ["x"], skipped: [] })),
    draftPlanFromUpgrades: vi.fn(async () => "# plan"),
    auditGeneratedPlan: vi.fn(() => ({
      safe: auditSafe,
      violations: auditSafe ? [] : [{ id: "rm-rf", reason: "unsafe", match: "rm -rf" }],
    })),
    draftRunner: { run: vi.fn(async () => ({ text: "", meta: {} })) },
    planRunner: vi.fn(async () => {}),
  };
}

test("hasApplicableEvidence 真值表", () => {
  expect(hasApplicableEvidence(undefined)).toBe(false);
  expect(hasApplicableEvidence({ costPerResolvedTask: 1 } as Parameters<typeof hasApplicableEvidence>[0])).toBe(false);
  expect(hasApplicableEvidence({ holdoutPassK: NaN, costPerResolvedTask: 1 })).toBe(false);
  expect(hasApplicableEvidence({ holdoutPassK: Infinity, costPerResolvedTask: 1 })).toBe(false); // 非有限数(仅 Infinity 能暴露 isFinite guard)
  expect(hasApplicableEvidence({ holdoutPassK: 0, costPerResolvedTask: 1 })).toBe(false);        // 零可靠性不得过闸(正向下限)
  expect(hasApplicableEvidence({ holdoutPassK: -0.1, costPerResolvedTask: 1 })).toBe(false);
  expect(hasApplicableEvidence({ holdoutPassK: 1.5, costPerResolvedTask: 1 })).toBe(false);      // 越界(>1)
  expect(hasApplicableEvidence({ holdoutPassK: 0.9, costPerResolvedTask: 1 })).toBe(true);       // baseline 缺省按 0，正增益可过闸
  expect(hasApplicableEvidence({ holdoutPassK: 1, costPerResolvedTask: 1, baseline: { holdoutPassK: 0.6 } })).toBe(true);
  expect(hasApplicableEvidence({ holdoutPassK: 0.6, costPerResolvedTask: 1, baseline: { holdoutPassK: 0.6 } })).toBe(false); // Δ=0 不过闸
  expect(hasApplicableEvidence({ holdoutPassK: 0.4, costPerResolvedTask: 1, baseline: { holdoutPassK: 0.6 } })).toBe(false);
  expect(hasApplicableEvidence({ holdoutPassK: 0.85, costPerResolvedTask: 1, baseline: { holdoutPassK: 0.8 } })).toBe(true);
});

test("evolutionProposalFromArtifact 透传 meta.proposal.evidence（生产 cli 映射不丢证据）", () => {
  const ev = { holdoutPassK: 0.9, costPerResolvedTask: 1, baseline: { holdoutPassK: 0.8 } };
  const art = { kind: "proposal", id: "p1", status: "approved", body: "", meta: { proposal: { changes: [upgrade()], evidence: ev } } } as Artifact;
  const ep = evolutionProposalFromArtifact(art);
  expect(ep.id).toBe("p1");
  expect(ep.status).toBe("approved");
  expect(ep.changes).toHaveLength(1);
  expect(ep.evidence).toEqual(ev);
});

test("evolutionProposalFromArtifact 无 evidence → undefined（不杜撰）", () => {
  const art = { kind: "proposal", id: "p2", status: "approved", body: "", meta: { proposal: { changes: [] } } } as Artifact;
  expect(evolutionProposalFromArtifact(art).evidence).toBeUndefined();
});

test("upgrade 无 evidence fail-closed：不跑计划、不 verified、记录 no-evidence", async () => {
  const deps = depsFor({ skills: [], conventions: [], upgrades: [upgrade()], unrouted: [] }, true);
  const proposals: EvolutionProposal[] = [
    { id: "p-no-ev", status: "approved", changes: [upgrade()] },
  ];

  const report = await applyApprovedProposals(proposals, deps);

  expect(deps.planRunner).not.toHaveBeenCalled();
  expect(report.plansRun).toBe(0);
  expect(report.outcomes[0].status).toBe("approved");
  expect(report.outcomes[0].planRun).toBe(false);
  expect(report.outcomes[0].violations.some((v) => v.id === "no-evidence")).toBe(true);
});

test("upgrade 有合格 evidence 且 audit safe：运行计划并 verified", async () => {
  const deps = depsFor({ skills: [], conventions: [], upgrades: [upgrade()], unrouted: [] }, true);
  const proposals: EvolutionProposal[] = [
    {
      id: "p-ev-safe",
      status: "approved",
      changes: [upgrade()],
      evidence: { holdoutPassK: 0.85, costPerResolvedTask: 1, baseline: { holdoutPassK: 0.8 } },
    },
  ];

  const report = await applyApprovedProposals(proposals, deps);

  expect(deps.planRunner).toHaveBeenCalledTimes(1);
  expect(report.plansRun).toBe(1);
  expect(report.outcomes[0].status).toBe("verified");
  expect(report.outcomes[0].planRun).toBe(true);
});

test("upgrade audit unsafe：合格 evidence 不绕过审计闸", async () => {
  const deps = depsFor({ skills: [], conventions: [], upgrades: [upgrade()], unrouted: [] }, false);
  const proposals: EvolutionProposal[] = [
    {
      id: "p-audit-unsafe",
      status: "approved",
      changes: [upgrade()],
      evidence: { holdoutPassK: 0.9, costPerResolvedTask: 1 },
    },
  ];

  const report = await applyApprovedProposals(proposals, deps);

  expect(deps.planRunner).not.toHaveBeenCalled();
  expect(report.plansRun).toBe(0);
  expect(report.outcomes[0].status).toBe("approved");
  expect(report.outcomes[0].planRun).toBe(false);
  expect(report.outcomes[0].violations.some((v) => v.id === "rm-rf")).toBe(true);
});

test("conventions-only 不受 evidence gate 影响", async () => {
  const deps = depsFor({ skills: [], conventions: [conv()], upgrades: [], unrouted: [] }, true);
  const proposals: EvolutionProposal[] = [
    { id: "p-conv", status: "approved", changes: [conv()] },
  ];

  const report = await applyApprovedProposals(proposals, deps);

  expect(deps.applyConventions).toHaveBeenCalledTimes(1);
  expect(deps.planRunner).not.toHaveBeenCalled();
  expect(report.conventionsApplied).toBe(1);
  expect(report.outcomes[0].status).toBe("verified");
});

test("persistProposal 渲染 evidence 数值或无证据警告", async () => {
  const store = new ArtifactStore(join(dir, "artifacts"));

  await persistProposal(store, "with-evidence", {
    sourceExperiences: ["e1"],
    changes: [conv("保留验证证据")],
    rejected: [],
    evidence: {
      holdoutPassK: 0.91,
      costPerResolvedTask: 2.5,
      baseline: { holdoutPassK: 0.88, costPerResolvedTask: 3 },
      measuredAt: 123456,
    },
  });
  const withEvidence = await store.read("with-evidence");
  expect(withEvidence.body).toContain("## 评测证据");
  expect(withEvidence.body).toContain("holdoutPassK: 0.91");
  expect(withEvidence.body).toContain("costPerResolvedTask: 2.5");
  expect(withEvidence.body).toContain("baseline.holdoutPassK: 0.88");
  expect(withEvidence.body).toContain("baseline.costPerResolvedTask: 3");
  expect(withEvidence.body).toContain("measuredAt: 123456");

  await persistProposal(store, "without-evidence", {
    sourceExperiences: ["e2"],
    changes: [conv("缺证据")],
    rejected: [],
  });
  const withoutEvidence = await store.read("without-evidence");
  expect(withoutEvidence.body).toContain("⚠ 无评测证据");
});

test("buildProposal 向后兼容：默认 evidence undefined 且字段不受影响", () => {
  const p = buildProposal(
    [exp("e1", { target: "conventions", text: "always lint" })],
    [
      { target: "conventions", text: "prefer deterministic checks", source: "digest:1" },
      { target: "constitution/core.md", text: "weaken core", source: "digest:2" },
    ],
  );

  expect(p.evidence).toBeUndefined();
  expect(p.sourceExperiences).toEqual(["e1"]);
  expect(p.changes.map((c) => c.source)).toEqual(["e1", "digest:1"]);
  expect(p.rejected).toHaveLength(1);
});