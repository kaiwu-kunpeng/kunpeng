import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { startDashboard } from "./http.js";
import { renderWeakPointsButton } from "./ui/views/loops.js";

let srv: { port: number; close: () => void } | undefined;
let tmpRepo: string | undefined;

afterEach(() => {
  srv?.close();
  srv = undefined;
  if (tmpRepo) rmSync(tmpRepo, { recursive: true, force: true });
  tmpRepo = undefined;
});

async function post(port: number, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(`http://127.0.0.1:${port}/api/loop-weakpoints`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as Record<string, unknown>;
}

test("POST /api/loop-weakpoints 用注入计算器返回 weakPoints", async () => {
  tmpRepo = mkdtempSync(join(tmpdir(), "kp-wp-"));
  let calledWith: string | undefined;
  srv = await startDashboard({
    port: 0,
    repoRoot: tmpRepo,
    loopWeakPoints: async (loopId: string) => {
      calledWith = loopId;
      return [{ target: "BRAKE_PAD", reason: "供应商 < 2", urgency: 3, expectedDelta: 40 }];
    },
  });
  const json = await post(srv.port, { projectId: "x", loopId: "acme-catalog" });
  expect(json.ok).toBe(true);
  expect(calledWith).toBe("acme-catalog");
  expect(json.weakPoints).toEqual([
    { target: "BRAKE_PAD", reason: "供应商 < 2", urgency: 3, expectedDelta: 40 },
  ]);
});

test("缺 loopId → ok:false 且不调用计算器", async () => {
  tmpRepo = mkdtempSync(join(tmpdir(), "kp-wp-"));
  let called = false;
  srv = await startDashboard({
    port: 0,
    repoRoot: tmpRepo,
    loopWeakPoints: async () => { called = true; return []; },
  });
  const json = await post(srv.port, { projectId: "x" });
  expect(json.ok).toBe(false);
  expect(called).toBe(false);
});

test("renderWeakPointsButton 渲染动作建议按钮（data-action+data-loop）", () => {
  const html = renderWeakPointsButton("acme-catalog");
  expect(html).toContain('data-action="loop-weakpoints"');
  expect(html).toContain('data-loop="acme-catalog"');
  expect(html).toContain('data-loop-weakpoints="acme-catalog"');
});