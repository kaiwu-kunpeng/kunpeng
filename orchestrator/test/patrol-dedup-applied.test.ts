import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore } from "../src/artifacts/store.js";
import { runPatrol } from "../src/loop/patrol.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kp-patrol-applied-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

// 回归：提案被批准应用（转出 draft）后，下一轮 patrol 不得再把同一条确定性 change 当 fresh 重提。
test("提案转 approved 后，重跑 patrol 仍对同一 change 去重（不只比对 draft）", async () => {
  const store = new ArtifactStore(join(dir, "artifacts"));
  await store.write({
    kind: "experience", id: "e1", status: "draft", body: "",
    meta: { sourceFlow: "flow-e1", outcome: "verified", proposedRuleChange: { target: "conventions", text: "提交前先跑 lint" } },
  });

  // 首跑 → 落一条 draft 提案，至少含一条 fresh change。
  const first = await runPatrol({ store, now: () => 1 });
  expect(first.proposalId).toBeTruthy();
  expect(first.freshChanges).toBeGreaterThanOrEqual(1);

  // 模拟人工门#2 批准应用：把提案推出 draft。
  await store.transition(first.proposalId!, "approved");

  // 重跑：同一确定性 change 必须被判 duplicate、不得再生成新提案。
  const second = await runPatrol({ store, now: () => 2 });
  expect(second.freshChanges).toBe(0);
  expect(second.proposalId).toBeUndefined();
  expect(second.duplicateChanges).toBeGreaterThanOrEqual(1);

  // 全程只该有那一条提案（approved），没有因重提再多一条。
  const proposals = await store.list("proposal");
  expect(proposals).toHaveLength(1);
  expect(proposals[0].status).toBe("approved");
});