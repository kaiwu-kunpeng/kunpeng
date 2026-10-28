import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendAction } from "../src/loop/action-ledger.js";
import "../src/server/routes/ops-actions.js";
import { dispatchModularRoute, listModularRoutes } from "../src/server/routes/registry.js";

describe("动作时间线(作者验收)", () => {
  it("路由已注册且返回台账内容", async () => {
    expect(listModularRoutes().some((r) => r.path === "/api/ops/actions")).toBe(true);
    const repo = await mkdtemp(join(tmpdir(), "kp-opsr-"));
    await appendAction(join(repo, ".kunpeng"), {
      at: Date.now(), loopId: "l1", projectId: "p1", recipe: "geo", lever: "expand",
      subject: "w1", metricKey: "cit", metricAfter: 2, metricDelta: 1, verified: true,
    });
    let body = "";
    const res = {
      end: (b?: string) => { body = String(b ?? ""); },
      setHeader: () => {}, writeHead: () => {},
    };
    const ok = await dispatchModularRoute("GET", "/api/ops/actions?days=30", {} as never, res as never, { repoRoot: repo, stateDir: join(repo, ".kunpeng") });
    expect(ok).toBe(true);
    expect(body).toContain("l1");
    expect(body).toContain("expand");
  });
});