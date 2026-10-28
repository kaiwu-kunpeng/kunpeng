import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isAuditableApiWrite } from "../../src/server/audit.js";
import { appendAction, readActions } from "../../src/loop/action-ledger.js";
import { resolveProjectStateDir } from "../../src/project/state-resolve.js";

describe("审计修复F", () => {
  it("isAuditableApiWrite 覆盖 PATCH 且不误伤 GET/非api", () => {
    expect(isAuditableApiWrite("PATCH", "/api/accounts")).toBe(true);
    expect(isAuditableApiWrite("POST", "/api/tasks")).toBe(true);
    expect(isAuditableApiWrite("PUT", "/api/x")).toBe(true);
    expect(isAuditableApiWrite("DELETE", "/api/accounts")).toBe(true);
    expect(isAuditableApiWrite("GET", "/api/accounts")).toBe(false);
    expect(isAuditableApiWrite("POST", "/foo")).toBe(false);
  });

  it("ops/actions 路径契约与 driver 写侧对齐(resolveProjectStateDir 基)", async () => {
    const repo = mkdtempSync(join(tmpdir(), "kp-opsact-"));
    try {
      const base = resolveProjectStateDir(repo, { stateDir: join(repo, ".kunpeng") });
      await appendAction(base, { at: Date.now(), loopId: "L1", projectId: "P1", recipe: "r", lever: "l", subject: "s", metricKey: "m", metricAfter: 1, metricDelta: 1, verified: true });
      const got = await readActions(base, { since: 0 });
      expect(got.length).toBe(1);
      expect((got[0] as { loopId?: string }).loopId).toBe("L1");
    } finally { rmSync(repo, { recursive: true, force: true }); }
  });
});