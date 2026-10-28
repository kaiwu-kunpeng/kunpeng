import type { ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createOpsGate, listOpsGates } from "../../src/loop/ops-gate.js";
import { startDashboard } from "../../src/server/http.js";
import type { SpawnFn } from "../../src/server/launch.js";
import { part07 } from "../../src/server/ui/client-parts/part07.js";

// 背景（2026-10-03 运营审计 A3 G3，总报告 P0-6b）：L4「对外可见且不可逆或花钱」按 policy/action-levels 是硬门、要二次确认，
// 但 /api/ops-gate-decide 对任何等级都一次放行，前端的 confirm 只是体验。本测试锁定：服务端对 L4 门缺 confirmed:true 即 400、不裁决、不起跑；
// L3 软门一次放行；前端 approve 请求体带 confirmed，L4 卡片带 data-level 供二次确认。

let tmpRepo: string | undefined;
let srv: { port: number; close: () => Promise<void> } | undefined;

afterEach(async () => {
  await srv?.close();
  srv = undefined;
  if (tmpRepo) rmSync(tmpRepo, { recursive: true, force: true });
  tmpRepo = undefined;
});

function spawnRecorder() {
  const calls: { cmd: string; args: string[] }[] = [];
  const spawn = ((cmd: string, args?: readonly string[]) => {
    calls.push({ cmd, args: [...(args ?? [])] });
    return { pid: 4242, unref() {} } as ChildProcess;
  }) as SpawnFn;
  return { calls, spawn };
}

async function decide(port: number, body: Record<string, unknown>): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`http://127.0.0.1:${port}/api/ops-gate-decide`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

describe("L4 运营门服务端二次确认（作者锁定）", () => {
  it("L4 门：不带 confirmed → 400、门仍 pending、不起跑；带 confirmed:true → 200、approved、起跑一次", async () => {
    tmpRepo = mkdtempSync(join(tmpdir(), "kp-ops-l4-"));
    const gate = await createOpsGate(tmpRepo, { projectId: "x", playbookId: "pb-l4", loopId: "loop-a", reason: "买量", level: "L4" }, 1000);
    const { calls, spawn } = spawnRecorder();
    srv = await startDashboard({ port: 0, repoRoot: tmpRepo, execPath: "/usr/bin/node", cliJs: "/x/cli.js", spawn });

    const denied = await decide(srv.port, { id: gate.id, decision: "approve" });
    expect(denied.status).toBe(400);
    expect(denied.json.ok).toBe(false);
    expect(String(denied.json.error)).toContain("L4");
    expect(calls).toHaveLength(0);
    expect((await listOpsGates(tmpRepo))[0]!.status).toBe("pending");

    const deniedFalse = await decide(srv.port, { id: gate.id, decision: "approve", confirmed: "yes" });
    expect(deniedFalse.status).toBe(400);

    const ok = await decide(srv.port, { id: gate.id, decision: "approve", confirmed: true });
    expect(ok.status).toBe(200);
    expect(ok.json.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect((await listOpsGates(tmpRepo))[0]!.status).toBe("approved");
  });

  it("L3 软门 / 无等级旧门：不带 confirmed 一次放行", async () => {
    tmpRepo = mkdtempSync(join(tmpdir(), "kp-ops-l3-"));
    const soft = await createOpsGate(tmpRepo, { projectId: "x", playbookId: "pb-l3", loopId: "loop-a", reason: "r", level: "L3" }, 1000);
    const legacy = await createOpsGate(tmpRepo, { projectId: "x", playbookId: "pb-old", loopId: "loop-b", reason: "r" }, 2000);
    const { calls, spawn } = spawnRecorder();
    srv = await startDashboard({ port: 0, repoRoot: tmpRepo, execPath: "/usr/bin/node", cliJs: "/x/cli.js", spawn });
    expect((await decide(srv.port, { id: soft.id, decision: "approve" })).status).toBe(200);
    expect((await decide(srv.port, { id: legacy.id, decision: "approve" })).status).toBe(200);
    expect(calls).toHaveLength(2);
  });

  it("前端：approve 请求体带 confirmed；L4 卡片按钮带 data-level 并在未走收件箱两段确认时再确认一次", () => {
    const approveBlock = part07.slice(part07.indexOf('action === "ops-gate-approve"'), part07.indexOf('action === "ops-gate-reject"'));
    expect(approveBlock).toContain('decision: "approve", confirmed: opsGateConfirmed');
    expect(approveBlock).toContain('attr(el, "data-level") === "L4"');
    expect(approveBlock).toContain("二次确认");
    const view = readFileSync(new URL("../../src/server/ui/views/action-inbox.ts", import.meta.url), "utf8");
    expect(view).toMatch(/data-action="ops-gate-approve"[^>]*data-level="\$\{level\}"/);
    expect(view).toContain('const level = escapeHtml(gate.level ?? "");');
  });
});