import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore } from "../src/artifacts/store.js";
import { liveAuditJson, runMaintenanceLive } from "../src/evolution/maintenance-run.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kp-maintrun-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("liveAuditJson:注入 run 直接返回其输出", async () => {
  const out = await liveAuditJson("/whatever", () => JSON.stringify({ vulnerabilities: {} }));
  expect(out).toBe(JSON.stringify({ vulnerabilities: {} }));
});

test("liveAuditJson:run 抛错但带 stdout(npm audit 有漏洞时的真实情形)→ 取 stdout，不抛", async () => {
  const payload = JSON.stringify({ vulnerabilities: { x: { name: "x", severity: "high" } } });
  const out = await liveAuditJson("/whatever", () => {
    const e = new Error("npm audit exit 1") as Error & { stdout: string };
    e.stdout = payload;
    throw e;
  });
  expect(out).toBe(payload);
});

test("liveAuditJson:run 抛错且无 stdout → 返回 {}，不抛", async () => {
  const out = await liveAuditJson("/whatever", () => { throw new Error("boom"); });
  expect(out).toBe("{}");
});

test("runMaintenanceLive:真写 proposal + 真 capture 到 repoRoot/.kunpeng（注入 audit/module）", async () => {
  let n = 0;
  const r = await runMaintenanceLive(dir, {
    auditJson: async () => JSON.stringify({ vulnerabilities: { lodash: { name: "lodash", severity: "critical" } } }),
    moduleStatuses: async () => [],
    now: () => 1,
    id: () => `id-${n++}`,
  });
  expect(r.proposalsWritten).toBeGreaterThanOrEqual(1);
  expect(r.capturesWritten).toBe(r.proposalsWritten);
  const proposals = await new ArtifactStore(join(dir, ".kunpeng", "artifacts")).list("proposal");
  expect(proposals.length).toBe(r.proposalsWritten);
  expect(proposals.some((p) => (p.meta as { proposal?: { channel?: string } } | undefined)?.proposal?.channel === "security")).toBe(true);
});
