import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore } from "../src/artifacts/store.js";
import { CaptureStore } from "../src/knowledge/capture-store.js";
import { runMaintenanceScan, type MaintenanceScanDeps } from "../src/evolution/maintenance-scan.js";
import type { ModuleStatus } from "../src/status/types.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kp-maint-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function mkDeps(over: Partial<MaintenanceScanDeps> = {}): MaintenanceScanDeps {
  let n = 0;
  return {
    store: new ArtifactStore(join(dir, "artifacts")),
    captures: new CaptureStore(join(dir, "captures"), undefined, null),
    auditJson: async () => JSON.stringify({ vulnerabilities: { lodash: { name: "lodash", severity: "critical" } } }),
    moduleStatuses: async () => [{ id: "x", name: "X", category: "ops", light: "red", wired: true } as ModuleStatus],
    now: () => 1,
    id: () => `id-${n++}`,
    ...over,
  };
}

test("扫描产出 security+module 发现，写真 proposal 产物 + 真 KB capture", async () => {
  const d = mkDeps();
  const r = await runMaintenanceScan(d);
  expect(r.selected).toBeGreaterThanOrEqual(2);
  expect(r.proposalsWritten).toBe(r.selected);
  expect(r.capturesWritten).toBe(r.selected);
  const proposals = await d.store.list("proposal");
  expect(proposals.length).toBe(r.proposalsWritten);
  const channels = proposals.map((p) => (p.meta as { proposal?: { channel?: string } } | undefined)?.proposal?.channel);
  expect(channels).toContain("security");
  expect(channels).toContain("module");
  const caps = await d.captures.listCaptures();
  expect(caps.length).toBe(r.capturesWritten);
  expect(caps.every((c) => c.kind === "self-evolution")).toBe(true);
});

test("每通道 top-N 限流生效", async () => {
  const many = ["a", "b", "c", "d"].map((idv) => ({ id: idv, name: idv.toUpperCase(), category: "ops", light: "red", wired: true } as ModuleStatus));
  const d = mkDeps({ moduleStatuses: async () => many, topN: 2 });
  await runMaintenanceScan(d);
  const proposals = await d.store.list("proposal");
  const moduleProps = proposals.filter((p) => (p.meta as { proposal?: { channel?: string } } | undefined)?.proposal?.channel === "module");
  expect(moduleProps.length).toBe(2);
});

test("空审计 + 全绿已接线模块 → 零发现零写入", async () => {
  const d = mkDeps({
    auditJson: async () => JSON.stringify({ vulnerabilities: {} }),
    moduleStatuses: async () => [{ id: "g", name: "G", category: "ops", light: "green", wired: true } as ModuleStatus],
  });
  const r = await runMaintenanceScan(d);
  expect(r.selected).toBe(0);
  expect((await d.store.list("proposal")).length).toBe(0);
  expect((await d.captures.listCaptures()).length).toBe(0);
});