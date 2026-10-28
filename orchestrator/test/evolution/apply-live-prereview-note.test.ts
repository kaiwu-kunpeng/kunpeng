import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore } from "../../src/artifacts/store.js";
import { preReviewNoteOf, runApplyApprovedLive } from "../../src/evolution/apply-live.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kp-apply-live-note-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

test("preReviewNoteOf：有预审结论折成一行附注；缺 reason 只留 verdict；没有预审 → undefined", () => {
  expect(preReviewNoteOf({ id: "p", meta: { preReview: { verdict: "reject", reason: "疑似削弱门", at: 1 } } })).toBe("预审 reject：疑似削弱门");
  expect(preReviewNoteOf({ id: "p", meta: { preReview: { verdict: "approve", reason: "改动小" } } })).toBe("预审 approve：改动小");
  expect(preReviewNoteOf({ id: "p", meta: { preReview: { verdict: "review" } } })).toBe("预审 review");
  expect(preReviewNoteOf({ id: "p", meta: { preReview: { verdict: "" } } })).toBeUndefined();
  expect(preReviewNoteOf({ id: "p", meta: {} })).toBeUndefined();
  expect(preReviewNoteOf({ id: "p" })).toBeUndefined();
});

test("预审 reject 的 approved 提案不再被硬门跳过：照走可执行证据闸，附注写进 meta.preReviewNote 与日志", async () => {
  const repoRoot = join(dir, "repo");
  const kunpengHome = join(dir, "home");
  const store = new ArtifactStore(join(repoRoot, ".kunpeng", "artifacts"));
  await store.write({
    kind: "proposal", id: "p-rejected-by-ai", status: "approved", body: "",
    meta: {
      proposal: { changes: [{ target: "upgrade", text: "升级评测器", source: "exp-1" }] },
      preReview: { verdict: "reject", reason: "疑似削弱门", at: 1 },
    },
  });
  await store.write({
    kind: "proposal", id: "p-plain", status: "approved", body: "",
    meta: { proposal: { changes: [{ target: "upgrade", text: "升级调度器", source: "exp-2" }] } },
  });
  const logs: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => { logs.push(args.map(String).join(" ")); });
  try {
    await runApplyApprovedLive(repoRoot, kunpengHome);
  } finally {
    log.mockRestore();
  }

  const rejected = await store.read("p-rejected-by-ai");
  expect(rejected.status).toBe("approved");
  expect(rejected.meta.preReviewNote).toBe("预审 reject：疑似削弱门");
  // 真走到了证据闸：upgrade 无 evidence → fail-closed 留 audit-block 痕迹（旧硬门下这条根本不会被处理）。
  expect((await store.read("audit-block-p-rejected-by-ai")).kind).toBe("review");
  expect((await store.read("p-plain")).meta.preReviewNote).toBeUndefined();
  expect(logs.some((line) => line.includes("预审附注") && line.includes("p-rejected-by-ai"))).toBe(true);
  expect(logs.some((line) => line.includes("硬门跳过"))).toBe(false);
});

test("apply-live 源码不再有预审硬门，只剩附注（源码级）", () => {
  const src = readFileSync(new URL("../../src/evolution/apply-live.ts", import.meta.url), "utf8");
  expect(src).not.toContain("isPreReviewReject");
  expect(src).not.toContain("硬门跳过");
  expect(src).toContain("preReviewNote");
  expect(src).toContain("export function preReviewNoteOf");
});