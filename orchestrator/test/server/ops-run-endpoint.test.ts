import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withCockpit } from "../support/cockpit-e2e.js";

describe("POST /api/ops/run(真 serve)", () => {
  it("缺参 400;loopId 带非法字符 400;未知 loop 由子进程处理(端点 200 返 pid)", async () => {
    const repo = await mkdtemp(join(tmpdir(), "kp-opsrun-repo-"));
    await withCockpit(repo, async ({ baseUrl }) => {
      const bad = await fetch(baseUrl + "/api/ops/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
      expect(bad.status).toBe(400);

      const inj = await fetch(baseUrl + "/api/ops/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: "p", loopId: "x; rm -rf" }) });
      expect(inj.status).toBe(400);

      const ok = await fetch(baseUrl + "/api/ops/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: "p", loopId: "no-such-loop" }) });
      expect(ok.status).toBe(200);
      const j = await ok.json();
      expect(j.ok).toBe(true);
      expect(typeof j.pid).toBe("number");
      expect(typeof j.logPath).toBe("string");
    });
  }, 30000);
});