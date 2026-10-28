import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore } from "../src/artifacts/store.js";
import { runPatrol } from "../src/loop/patrol.js";
import type { Researcher } from "../src/research/types.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kp-patrol-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

// 桩研究：恒返回一条带可信 url 来源 + 建议约定的发现（过验真、可合成提案）。
const researcher: Researcher = {
  async research(topic) {
    return [{ topic, source: "https://example.com/best-practice", summary: "s", suggestedConvention: "为 " + topic + " 补一条约定" }];
  },
};

test("首跑：内部经验 + 桩研究 → 落一条 draft 提案（A1/A2/A3/A5/A7）", async () => {
  const store = new ArtifactStore(join(dir, "artifacts"));
  await store.write({
    kind: "experience", id: "e1", status: "draft", body: "",
    meta: { sourceFlow: "flow-e1", outcome: "verified", proposedRuleChange: { target: "conventions", text: "提交前先跑 lint" } },
  });

  const r = await runPatrol({ store, researcher, researchTopics: ["ci"], now: () => 1 });

  expect(r.researched).toBe(true);
  expect(r.freshChanges).toBeGreaterThanOrEqual(2);
  expect(r.proposalId).toBeTruthy();

  const art = await store.read(r.proposalId!);
  expect(art.kind).toBe("proposal");
  expect(art.status).toBe("draft");
});

test("复跑：无新经验、研究产同候选 → 全去重、不再落盘（A4/A5），全程仅一条且恒 draft（A7）", async () => {
  const store = new ArtifactStore(join(dir, "artifacts"));
  await store.write({
    kind: "experience", id: "e1", status: "draft", body: "",
    meta: { sourceFlow: "flow-e1", outcome: "verified", proposedRuleChange: { target: "conventions", text: "提交前先跑 lint" } },
  });

  const first = await runPatrol({ store, researcher, researchTopics: ["ci"], now: () => 1 });
  expect(first.proposalId).toBeTruthy();

  const second = await runPatrol({ store, researcher, researchTopics: ["ci"], now: () => 2 });
  expect(second.freshChanges).toBe(0);
  expect(second.proposalId).toBeUndefined();
  expect(second.duplicateChanges).toBeGreaterThanOrEqual(2);

  const proposals = await store.list("proposal");
  expect(proposals).toHaveLength(1);
  expect(proposals.every((p) => p.status === "draft")).toBe(true);
});