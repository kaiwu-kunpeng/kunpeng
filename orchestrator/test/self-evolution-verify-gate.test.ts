import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore } from "../src/artifacts/store.js";
import type { Artifact } from "../src/artifacts/types.js";
import { runPatrol } from "../src/loop/patrol.js";
import { buildProposal, experienceUnverifiedReason, persistProposal } from "../src/loop/self-evolution.js";

// 手写种子经验的真实形态（.kunpeng/artifacts/exp-lesson-*-20260619.md）：有候选规则、无任何验真字段。
const SEED: Artifact = {
  kind: "experience", id: "exp-lesson-seed-20260619", status: "draft", body: "手写教训",
  meta: { source_group: "dev-loop", context: "2026-06-19 手写", proposedRuleChange: { target: "conventions.md", text: "验收必须作者亲写" } },
};
// dev-cycle 在流过验收后写入的形态：sourceFlow + outcome=verified（+ evidence）。
const FROM_VERIFIED_FLOW: Artifact = {
  kind: "experience", id: "exp-flow-a-1", status: "draft", body: "flow flow-a-0-0 → verified",
  meta: { sourceFlow: "flow-a-0-0", outcome: "verified", evidence: "Tests 3 passed", proposedRuleChange: { target: "conventions", text: "提交前先跑 lint" } },
};

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kp-verify-gate-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

test("验真判据：verifiedBy 署名、或 outcome=verified 且 sourceFlow 非空才算；其余给出理由", () => {
  expect(experienceUnverifiedReason(SEED)).toContain("无验真证据");
  expect(experienceUnverifiedReason({ meta: {} })).toContain("缺 meta.verifiedBy");
  expect(experienceUnverifiedReason({ meta: { verifiedBy: "" } })).toContain("无验真证据");
  expect(experienceUnverifiedReason({ meta: { verifiedBy: "   " } })).toContain("无验真证据");
  expect(experienceUnverifiedReason({ meta: { verifiedBy: "reviewer@2026-09-18" } })).toBeUndefined();
  expect(experienceUnverifiedReason(FROM_VERIFIED_FLOW)).toBeUndefined();
  expect(experienceUnverifiedReason({ meta: { outcome: "verified" } })).toContain("缺 meta.sourceFlow");
  expect(experienceUnverifiedReason({ meta: { outcome: "verified", sourceFlow: " " } })).toContain("缺 meta.sourceFlow");
  expect(experienceUnverifiedReason({ meta: { outcome: "rolled-back", sourceFlow: "flow-b-0-0" } })).toContain("无验真证据");
});

test("buildProposal 只吃带验真证据的经验：种子进 skipped 带理由，不进 sourceExperiences/changes；extra 与 core 护栏不受影响", () => {
  const noCandidate: Artifact = { kind: "experience", id: "exp-no-candidate", status: "draft", body: "", meta: { sourceFlow: "flow-c-0-0", outcome: "verified" } };
  const coreOnVerified: Artifact = {
    kind: "experience", id: "exp-core", status: "draft", body: "",
    meta: { verifiedBy: "reviewer", proposedRuleChange: { target: "constitution/core.md", text: "改核心" } },
  };
  const p = buildProposal(
    [SEED, FROM_VERIFIED_FLOW, noCandidate, coreOnVerified],
    [{ target: "conventions", text: "extra 不受验真门影响", source: "digest:1" }],
  );
  expect(p.skipped).toHaveLength(1);
  expect(p.skipped?.[0]?.id).toBe("exp-lesson-seed-20260619");
  expect(p.skipped?.[0]?.reason).toContain("无验真证据");
  expect(p.sourceExperiences).toEqual(["exp-flow-a-1", "exp-core"]);
  expect(p.changes.map((c) => c.source)).toEqual(["exp-flow-a-1", "digest:1"]);
  expect(p.rejected.map((r) => r.change.source)).toEqual(["exp-core"]);
});

test("persistProposal 把跳过清单写进正文；无跳过时不出现该段", async () => {
  const store = new ArtifactStore(join(dir, "artifacts"));
  await persistProposal(store, "with-skipped", {
    sourceExperiences: [], changes: [], rejected: [],
    skipped: [{ id: "exp-lesson-seed-20260619", reason: "无验真证据：x" }],
  });
  const body = (await store.read("with-skipped")).body;
  expect(body).toContain("## 跳过（无验真证据，C6）");
  expect(body).toContain("- exp-lesson-seed-20260619 — 无验真证据：x");
  await persistProposal(store, "without-skipped", { sourceExperiences: [], changes: [], rejected: [] });
  expect((await store.read("without-skipped")).body).not.toMatch(/## 跳过/);
});

test("runPatrol：只有手写种子 → 不落提案、skippedExperiences=1；加入已验证流经验 → 落提案且 meta.proposal.skipped 记录种子", async () => {
  const store = new ArtifactStore(join(dir, "artifacts"));
  await store.write(SEED);
  const onlySeed = await runPatrol({ store, now: () => 1 });
  expect(onlySeed.proposalId).toBeUndefined();
  expect(onlySeed.freshChanges).toBe(0);
  expect(onlySeed.skippedExperiences).toBe(1);
  expect(await store.list("proposal")).toHaveLength(0);

  await store.write(FROM_VERIFIED_FLOW);
  const withVerified = await runPatrol({ store, now: () => 2 });
  expect(withVerified.proposalId).toBeTruthy();
  expect(withVerified.freshChanges).toBe(1);
  expect(withVerified.skippedExperiences).toBe(1);
  const meta = (await store.read(withVerified.proposalId!)).meta as {
    proposal?: { sourceExperiences?: string[]; skipped?: { id: string; reason: string }[] };
  };
  expect(meta.proposal?.sourceExperiences).toEqual(["exp-flow-a-1"]);
  expect(meta.proposal?.skipped?.map((s) => s.id)).toEqual(["exp-lesson-seed-20260619"]);
});

test("巡检日志一行带出无验真跳过数（源码级）", () => {
  const src = readFileSync(new URL("../src/cli-commands/loop-core.ts", import.meta.url), "utf8");
  expect(src).toContain("无验真跳过");
  expect(src).toContain("r.skippedExperiences");
});