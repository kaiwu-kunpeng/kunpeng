import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, readFile, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore } from "../../src/artifacts/store.js";
import { runApplyApprovedLive } from "../../src/evolution/apply-live.js";

const DAY = 24 * 60 * 60 * 1000;
let dir: string;
let store: ArtifactStore;
let log: import("vitest").MockInstance<(...args: unknown[]) => void>;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "kp-apply-live-expiry-"));
  await mkdir(join(dir, ".kunpeng", "artifacts"), { recursive: true });
  await mkdir(join(dir, "constitution"), { recursive: true });
  store = new ArtifactStore(join(dir, ".kunpeng", "artifacts"));
  log = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  log.mockRestore();
  rmSync(dir, { recursive: true, force: true });
});

// 目标故意用未知 target："x-unknown"：route 会兜到 unrouted，既不写约定文件也不跑升级计划。
async function seedApproved(id: string, ageDays: number): Promise<void> {
  await store.write({
    kind: "proposal", id, status: "approved", body: `# ${id}`,
    meta: { proposal: { changes: [{ target: "x-unknown", text: `rule ${id}`, source: "exp-1" }] } },
  });
  const t = new Date(Date.now() - ageDays * DAY);
  await utimes(join(dir, ".kunpeng", "artifacts", `${id}.md`), t, t);
}

test("runApplyApprovedLive：approved 超 30 天的提案被自动退回 rolled-back，新近 approved 不动", async () => {
  await seedApproved("stale-68d", 68);
  await seedApproved("fresh-2d", 2);

  await runApplyApprovedLive(dir, dir);

  const stale = await store.read("stale-68d");
  expect(stale.status).toBe("rolled-back");
  expect(stale.meta.humanDecision).toBe("expired");
  expect(stale.meta.expiredReason).toBe("approved 超 30 天未落地，自动退回");
  expect(typeof stale.meta.expiredAt).toBe("string");
  const fresh = await store.read("fresh-2d");
  expect(fresh.status).toBe("approved");
  expect(fresh.meta.humanDecision).toBeUndefined();

  const lines = log.mock.calls.map((c) => String(c[0]));
  expect(lines.some((l) => l.includes("stale-68d") && l.includes("自动退回"))).toBe(true);
  // 原文件仍在（只改状态，不删除产物）。
  expect(await readFile(join(dir, ".kunpeng", "artifacts", "stale-68d.md"), "utf8")).toContain("status: rolled-back");
});

test("runApplyApprovedLive：退回后无 approved 剩余时按原路径提前返回（不抛错）", async () => {
  await seedApproved("stale-40d", 40);
  await expect(runApplyApprovedLive(dir, dir)).resolves.toBeUndefined();
  expect((await store.read("stale-40d")).status).toBe("rolled-back");
  expect(log.mock.calls.map((c) => String(c[0])).some((l) => l.includes("无已批准"))).toBe(true);
});