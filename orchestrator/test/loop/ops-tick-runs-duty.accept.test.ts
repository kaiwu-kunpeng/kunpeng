import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../src/cli-commands/ops.js";
import "../../src/cli-commands/duty.js";
import { listCliCommands } from "../../src/cli-commands/registry.js";
import { runDutyForRepo } from "../../src/cli-commands/duty.js";
import { runbookLedgerPath, type DutyTickItem } from "../../src/loop/runbooks/duty-officer.js";
import { FlowTracker } from "../../src/runtime/flowstate.js";
import { resolveProjectStateDir } from "../../src/project/state-resolve.js";

// 背景（2026-10-03 运营审计 A4 #1，总报告 P1-12 第三步；前置 P1-12b 已合入）：`kunpeng duty tick` 得有人去跑才有用。
// 本测试锁定：`ops` 定时器每轮末尾自动跑一次值班员（幽灵流被标 crashed、台账落 executed）；`--no-duty` 可关；
// 值班员抛错不影响定时器本轮；`runDutyForRepo` 作为共用入口可被直接调用并返回明细。

let repo: string; let savedState: string | undefined;
const ghostPid = 2_147_483_000;
beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  repo = mkdtempSync(join(tmpdir(), "kp-ops-duty-"));
  savedState = process.env.KUNPENG_STATE; process.env.KUNPENG_STATE = mkdtempSync(join(tmpdir(), "kp-ops-duty-global-"));
  mkdirSync(join(repo, ".kunpeng"), { recursive: true });
  writeFileSync(join(repo, ".kunpeng", "project.json"), JSON.stringify({ id: "demo", name: "Demo", registeredAt: 1 }));
  const tracker = new FlowTracker(resolveProjectStateDir(repo));
  await tracker.start("ghost-1", "r");
  const path = join(resolveProjectStateDir(repo), "ghost-1.json");
  const state = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  writeFileSync(path, JSON.stringify({ ...state, status: "running", pid: ghostPid, host: undefined, lease: undefined }));
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(process.env.KUNPENG_STATE!, { recursive: true, force: true });
  if (savedState === undefined) delete process.env.KUNPENG_STATE; else process.env.KUNPENG_STATE = savedState;
  rmSync(repo, { recursive: true, force: true });
});
const ops = () => listCliCommands().find((c) => c.name === "ops")!;
const ctx = (rest: string[]) => ({ repoRoot: repo, repoArg: repo, rest, flags: new Set(rest.filter((a) => a.startsWith("--"))), argv: ["ops", ...rest] }) as never;
const flowStatus = async () => (await new FlowTracker(resolveProjectStateDir(repo)).read("ghost-1"))?.status;
const ledger = () => { try { return readFileSync(runbookLedgerPath(resolveProjectStateDir(repo)), "utf8").trim().split("\n").map((l) => JSON.parse(l) as { outcome: string; runbookId?: string }); } catch { return []; } };

describe("ops 定时器每轮跑值班员（作者锁定）", () => {
  it("无到期 playbook 的一轮：幽灵流被值班员标 crashed，台账记 rb-flow-ghost executed", async () => {
    expect(await flowStatus()).toBe("running");
    await ops().run(ctx(["--repo", repo]));
    expect(await flowStatus()).toBe("crashed");
    expect(ledger()).toEqual([expect.objectContaining({ outcome: "executed", runbookId: "rb-flow-ghost" })]);
  });

  it("--no-duty：定时器照跑，值班员不动，流仍 running、无台账", async () => {
    await ops().run(ctx(["--repo", repo, "--no-duty"]));
    expect(await flowStatus()).toBe("running");
    expect(ledger()).toEqual([]);
  });

  it("runDutyForRepo 共用入口：--dry 返回 dry-run 明细且不落账；日志走传入的 log", async () => {
    const lines: string[] = [];
    const items: DutyTickItem[] = await runDutyForRepo({ repoRoot: repo, dryRun: true, log: (l) => { lines.push(l); } });
    expect(items.map((i) => [i.outcome, i.event.kind])).toEqual([["dry-run", "flow.ghost"]]);
    expect(lines.some((l) => l.startsWith("[duty] 事件 1 条"))).toBe(true);
    expect(ledger()).toEqual([]);
    expect(await flowStatus()).toBe("running");
  });
});