import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMaintenanceScan } from "../../src/evolution/maintenance-scan.js";
import { runMaintenanceLive } from "../../src/evolution/maintenance-run.js";
import { findingKey } from "../../src/evolution/self-evo-finding.js";
import type { ArtifactStore } from "../../src/artifacts/store.js";
import type { CaptureStore } from "../../src/knowledge/capture-store.js";

const AUDIT = JSON.stringify({ vulnerabilities: { vitest: { name: "vitest", severity: "critical" } } });
function fakeStore(): ArtifactStore & { w: unknown[] } {
  const w: unknown[] = [];
  return { w, write: async (artifact: unknown) => { w.push(artifact); } } as unknown as ArtifactStore & { w: unknown[] };
}
function fakeCaptures(): CaptureStore {
  return { appendCapture: async () => true } as unknown as CaptureStore;
}

let dirs: string[] = [];
function tmp() { const d = mkdtempSync(join(tmpdir(), "kp-dedup-")); dirs.push(d); return d; }
afterEach(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); dirs = []; });

describe("maintain 跨轮去重", () => {
  it("scan: 无 existingKeys → 写该 security 提案", async () => {
    const r = await runMaintenanceScan({ store: fakeStore(), captures: fakeCaptures(), auditJson: async () => AUDIT, moduleStatuses: async () => [], now: () => 1, id: () => "x" });
    expect(r.proposalsWritten).toBe(1);
  });
  it("scan: existingKeys 含该 finding 的 key → 跳过不重写", async () => {
    const store = fakeStore();
    const key = findingKey({
      channel: "security",
      title: "依赖漏洞：vitest（critical）",
    } as Parameters<typeof findingKey>[0]);
    const r = await runMaintenanceScan({ store, captures: fakeCaptures(), auditJson: async () => AUDIT, moduleStatuses: async () => [], now: () => 1, id: () => "x", existingKeys: async () => new Set([key]) });
    expect(r.proposalsWritten).toBe(0);
    expect(store.w.length).toBe(0);
  });
  it("live(端到端): 第1轮写 proposal，第2轮(同 store)同款被去重", async () => {
    const dir = tmp();
    const r1 = await runMaintenanceLive(dir, { auditJson: async () => AUDIT, moduleStatuses: async () => [] });
    expect(r1.proposalsWritten).toBe(1);
    const r2 = await runMaintenanceLive(dir, { auditJson: async () => AUDIT, moduleStatuses: async () => [] });
    expect(r2.proposalsWritten).toBe(0); // store 已有同款 → 跨轮去重
  });
});
