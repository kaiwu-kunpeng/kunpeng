import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acquireOpsLock, isLockBusy, opsLockPath, readOpsLock } from "../../src/loop/ops-lock.js";
import { opsSchedulePath, runPlaybook, type OpsScheduleEntry } from "../../src/loop/ops-playbook-run.js";
import { cadenceMs } from "../../src/loop/ops-run.js";
import { parsePlaybook } from "../../src/loop/playbook.js";
import { LoopStore } from "../../src/loop/store.js";
import type { LoopDef } from "../../src/loop/types.js";
import { opsRunPlaybookArgs } from "../../src/server/launch.js";

// 背景（ADR-0020 / 2026-10-03 运营审计 A3 G1，总报告 P1-1）：真实的运营调度器是仓外 328 行 zsh 脚本——每段「节流 → pgrep 并发锁 →
// ops-pilot → loop run → ops-report」，不受 scope 门 / 测试 / 版本控制约束；`kunpeng ops` 的 cadence 调度器只会裸起 `loop run`。
// 本测试锁定脚本职责收回仓内：`every:<n><h|d|w>` 节奏、playbook `pilot: true`、同 loop 并发锁、`ops run-playbook` 一段式执行与应跑账本。

const DAY = 86_400_000;
let repo: string;
let stateDir: string;

function loopDef(): LoopDef {
  return { id: "demo-geo", name: "Demo GEO", projectId: "demo", recipe: "geo-monitor", autonomous: true,
    metric: { key: "m", label: "M", current: 1 }, levers: [{ id: "geo-sweep", label: "扫", status: "active", level: "L0" }],
    nextLever: { lever: "geo-sweep", target: "https://demo.example/" }, waves: [], createdAt: 1, updatedAt: 1 };
}
function writePlaybook(id: string, extra = ""): void {
  mkdirSync(join(repo, ".kunpeng", "playbooks"), { recursive: true });
  writeFileSync(join(repo, ".kunpeng", "playbooks", `${id}.md`), `---\nid: ${id}\nloopId: demo-geo\ncadence: every:6d\ngate: auto\n${extra}---\n# ${id}\n正文\n`, "utf8");
}
function ledger(): OpsScheduleEntry[] {
  const p = opsSchedulePath(stateDir);
  return existsSync(p) ? readFileSync(p, "utf8").trim().split("\n").map((l) => JSON.parse(l) as OpsScheduleEntry) : [];
}
const ranWave = (seq: number) => async (loopId: string) => ({ gated: false as const, loop: loopDef(), flowId: `loop-${loopId}-w${seq}`,
  wave: { seq, at: 1, lever: "geo-sweep", subject: "s", metricDelta: 1, metricAfter: 2, verified: true },
  result: { metricBefore: 1, metricAfter: 2, metricDelta: 1, verified: true } });

beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "kp-ops-pb-"));
  execFileSync("git", ["init", "--quiet", repo]);
  stateDir = join(repo, ".kunpeng", "state");
  await new LoopStore(join(repo, ".kunpeng", "loops")).create(loopDef());
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("运营调度收回 kunpeng ops（作者锁定）", () => {
  it("节奏：every:<n><h|d|w> 生效，旧写法与缺省不变", () => {
    expect(cadenceMs("every:6d")).toBe(6 * DAY);
    expect(cadenceMs("every:12h")).toBe(12 * 3_600_000);
    expect(cadenceMs("every:2w")).toBe(14 * DAY);
    expect(cadenceMs("every:0d")).toBe(7 * DAY);
    expect(cadenceMs("daily")).toBe(DAY);
    expect(cadenceMs(undefined)).toBe(7 * DAY);
  });

  it("playbook 前言 pilot: true → pilot 字段；没写不带该键", () => {
    expect(parsePlaybook("---\nid: a\nloopId: l\npilot: true\n---\n# a\n")!.pilot).toBe(true);
    expect(parsePlaybook("---\nid: b\nloopId: l\n---\n# b\n")).not.toHaveProperty("pilot");
  });

  it("并发锁：持有者活着就忙；持有者已死可接管；释放即删文件", async () => {
    const alive = () => true;
    const dead = () => false;
    const release = await acquireOpsLock(stateDir, "demo-geo", { pid: 4242, playbookId: "pb", now: () => 100, isAlive: alive });
    expect(release).not.toBeNull();
    expect(await readOpsLock(stateDir, "demo-geo")).toEqual({ pid: 4242, at: 100, playbookId: "pb" });
    expect(isLockBusy(await readOpsLock(stateDir, "demo-geo"), alive)).toBe(true);
    expect(await acquireOpsLock(stateDir, "demo-geo", { pid: 1, isAlive: alive })).toBeNull();
    const takeover = await acquireOpsLock(stateDir, "demo-geo", { pid: 7, now: () => 200, isAlive: dead });
    expect(takeover).not.toBeNull();
    expect((await readOpsLock(stateDir, "demo-geo"))?.pid).toBe(7);
    await takeover!();
    expect(existsSync(opsLockPath(stateDir, "demo-geo"))).toBe(false);
  });

  it("run-playbook：pilot → 跑波 → 账本 ran；锁忙时不跑、账本 locked；跑完锁已释放", async () => {
    writePlaybook("pb-geo", "pilot: true\n");
    const pilot = vi.fn(async () => undefined);
    const runWave = vi.fn(ranWave(1));
    const entry = await runPlaybook(repo, stateDir, "pb-geo", { pilot, runWave, now: () => 1_000, log: () => undefined });
    expect(entry).toMatchObject({ playbookId: "pb-geo", loopId: "demo-geo", outcome: "ran" });
    expect(pilot).toHaveBeenCalledWith("demo-geo");
    expect(runWave).toHaveBeenCalledTimes(1);
    expect(pilot.mock.invocationCallOrder[0]!).toBeLessThan(runWave.mock.invocationCallOrder[0]!);
    expect(existsSync(opsLockPath(stateDir, "demo-geo"))).toBe(false);

    await acquireOpsLock(stateDir, "demo-geo", { pid: 99, isAlive: () => true });
    const locked = await runPlaybook(repo, stateDir, "pb-geo", { pilot, runWave, isAlive: () => true, now: () => 2_000, log: () => undefined });
    expect(locked.outcome).toBe("locked");
    expect(runWave).toHaveBeenCalledTimes(1);
    expect(ledger().map((e) => e.outcome)).toEqual(["ran", "locked"]);
  });

  it("run-playbook：没 pilot 标就不领航；门禁早退记 gated；未知 playbook 记 error", async () => {
    writePlaybook("pb-plain");
    const pilot = vi.fn(async () => undefined);
    const gated = vi.fn(async (loopId: string) => ({ gated: true as const, flowId: `loop-${loopId}-gate-1`, loop: loopDef(), humanGate: { gate: "运营 loop 对外推送", what: "w" } }));
    const g = await runPlaybook(repo, stateDir, "pb-plain", { pilot, runWave: gated, now: () => 3_000, log: () => undefined });
    expect(pilot).not.toHaveBeenCalled();
    expect(g.outcome).toBe("gated");
    const e = await runPlaybook(repo, stateDir, "nope", { log: () => undefined });
    expect(e.outcome).toBe("error");
    expect(ledger().map((x) => x.outcome)).toEqual(["gated", "error"]);
  });

  it("定时器到期的 auto playbook 走 ops run-playbook，而不是裸 loop run；锁忙时只记账不起", () => {
    expect(opsRunPlaybookArgs("pb-geo", "/r")).toEqual(["ops", "run-playbook", "pb-geo", "--repo", "/r"]);
    const src = readFileSync(new URL("../../src/cli-commands/ops.ts", import.meta.url), "utf8");
    const auto = src.slice(src.indexOf('playbook.gate === "auto"'), src.indexOf("if (!loopId) {", src.indexOf('playbook.gate === "auto"')));
    expect(auto).toContain("opsRunPlaybookArgs(playbook.id");
    expect(auto).not.toContain("loopRunArgs(");
    expect(auto).toContain('outcome: "locked"');
    expect(src).toContain('context.rest[0] === "run-playbook"');
  });
});