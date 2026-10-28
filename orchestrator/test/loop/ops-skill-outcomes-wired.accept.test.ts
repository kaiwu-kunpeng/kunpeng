import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appendAction } from "../../src/loop/action-ledger.js";
import { runPlaybook } from "../../src/loop/ops-playbook-run.js";
import { LoopStore } from "../../src/loop/store.js";
import type { LoopDef } from "../../src/loop/types.js";
import type { PersistSkillOutcomesInput } from "../../src/loop/wave-report.js";
import { listSkills, registerSkill, skillsRoot } from "../../src/skills/registry.js";

// 背景（2026-10-03 运营审计 A3 G4，总报告 P1-8）：技能战绩不落注册表——`persistSkillOutcomes` 在仓里没有任何调用方，
// 领航（ops-pilot）选了技能、波跑完了，赢输从来没写回去，pilot 下次照样拿零战绩的候选。
// 本测试锁定：`ops run-playbook` 跑完一波（ran）后，把该 loop 的 waveplan 与本波台账喂给 persistSkillOutcomes；
// 真实注册表里 verified && Δ>0 记 win；没有 waveplan 的 loop 不触发；写回失败不影响波次结果。

let repo: string;
let stateDir: string;
let savedState: string | undefined;

function loopDef(): LoopDef {
  return { id: "demo-skilled", name: "Demo", projectId: "demo", recipe: "agent-playbook", autonomous: true,
    metric: { key: "m", label: "M", current: 1 }, levers: [{ id: "write", label: "写", status: "active", level: "L2" }],
    nextLever: { lever: "write", target: "t" }, waves: [], createdAt: 1, updatedAt: 1 };
}
function writePlaybook(id: string, loopId: string): void {
  mkdirSync(join(repo, ".kunpeng", "playbooks"), { recursive: true });
  writeFileSync(join(repo, ".kunpeng", "playbooks", `${id}.md`), `---\nid: ${id}\nloopId: ${loopId}\ncadence: daily\ngate: auto\n---\n# ${id}\n`, "utf8");
}
function writeWaveplan(loopId: string, at: number, skills: string[]): void {
  mkdirSync(join(stateDir, "ops"), { recursive: true });
  writeFileSync(join(stateDir, "ops", "waveplans.jsonl"), `${JSON.stringify({ at, loopId, plan: { skills } })}\n`, { flag: "a" });
}
/** 假的跑波：像真 driver 一样先往台账追加一条，再返回 ran 结果。 */
function fakeRunWave(opts: { verified: boolean; delta: number; at: number }) {
  return vi.fn(async (loopId: string) => {
    await appendAction(stateDir, { at: opts.at, loopId, projectId: "demo", recipe: "agent-playbook", lever: "write", subject: "t", metricKey: "m", metricAfter: 1 + opts.delta, metricDelta: opts.delta, verified: opts.verified });
    return { gated: false as const, loop: loopDef(), flowId: `loop-${loopId}-w1`, wave: { seq: 1, at: opts.at, lever: "write", subject: "t", metricDelta: opts.delta, metricAfter: 1 + opts.delta, verified: opts.verified }, result: { metricBefore: 1, metricAfter: 1 + opts.delta, metricDelta: opts.delta, verified: opts.verified } };
  });
}

beforeEach(async () => {
  savedState = process.env.KUNPENG_STATE;
  process.env.KUNPENG_STATE = mkdtempSync(join(tmpdir(), "kp-skill-state-"));
  repo = mkdtempSync(join(tmpdir(), "kp-skill-repo-"));
  execFileSync("git", ["init", "--quiet", repo]);
  stateDir = join(repo, ".kunpeng", "state");
  await new LoopStore(join(repo, ".kunpeng", "loops")).create(loopDef());
  const skillDir = join(repo, "skills", "demo-writing");
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), "---\nname: demo-writing\ndescription: d\n---\n正文\n", "utf8");
  registerSkill(skillsRoot(), { id: "demo-writing", name: "demo-writing", description: "d", origin: "authored", dir: skillDir });
});
afterEach(() => {
  rmSync(process.env.KUNPENG_STATE!, { recursive: true, force: true });
  if (savedState === undefined) delete process.env.KUNPENG_STATE; else process.env.KUNPENG_STATE = savedState;
  rmSync(repo, { recursive: true, force: true });
});

describe("学习环接通：波结束写回技能战绩（作者锁定）", () => {
  it("有 waveplan 的 loop 跑完 ran → persistOutcomes 收到该 loop 的 waveplan 与本波台账", async () => {
    writePlaybook("pb-skilled", "demo-skilled");
    writeWaveplan("demo-skilled", 1_000, ["demo-writing"]);
    writeWaveplan("other-loop", 1_000, ["demo-writing"]);
    const persist = vi.fn(async (_i: PersistSkillOutcomesInput) => ({ processedWaves: 1, recordedOutcomes: 1, newlyDeprecated: [] }));
    const entry = await runPlaybook(repo, stateDir, "pb-skilled", { runWave: fakeRunWave({ verified: true, delta: 2, at: 2_000 }), persistOutcomes: persist, log: () => undefined, now: () => 3_000 });
    expect(entry.outcome).toBe("ran");
    expect(persist).toHaveBeenCalledTimes(1);
    const input = persist.mock.calls[0]![0];
    expect((input.waveplans as Array<{ loopId: string }>).map((w) => w.loopId)).toEqual(["demo-skilled"]);
    expect((input.actions as Array<{ loopId: string; at: number }>)[0]).toMatchObject({ loopId: "demo-skilled", at: 2_000 });
  });

  it("真实注册表：verified 且 Δ>0 → 技能 wins +1；再跑同一波幂等不重记", async () => {
    writePlaybook("pb-skilled", "demo-skilled");
    writeWaveplan("demo-skilled", 1_000, ["demo-writing"]);
    const run = fakeRunWave({ verified: true, delta: 2, at: 2_000 });
    const lines: string[] = [];
    await runPlaybook(repo, stateDir, "pb-skilled", { runWave: run, log: (l) => { lines.push(l); }, now: () => 3_000 });
    let skill = listSkills(skillsRoot()).find((s) => s.id === "demo-writing");
    expect(skill?.usage?.wins ?? 0).toBe(1);
    expect(lines.some((l) => l.includes("技能战绩已写回"))).toBe(true);
    await runPlaybook(repo, stateDir, "pb-skilled", { runWave: fakeRunWave({ verified: true, delta: 1, at: 2_000 }), log: () => undefined, now: () => 4_000 });
    skill = listSkills(skillsRoot()).find((s) => s.id === "demo-writing");
    expect(skill?.usage?.wins ?? 0).toBe(1);
  });

  it("verified 但 Δ≤0 记 loss；没有 waveplan 的 loop 不触发；写回抛错不影响 ran", async () => {
    writePlaybook("pb-skilled", "demo-skilled");
    writeWaveplan("demo-skilled", 1_000, ["demo-writing"]);
    await runPlaybook(repo, stateDir, "pb-skilled", { runWave: fakeRunWave({ verified: true, delta: 0, at: 2_000 }), log: () => undefined, now: () => 3_000 });
    const skill = listSkills(skillsRoot()).find((s) => s.id === "demo-writing");
    expect(skill?.usage?.losses ?? 0).toBe(1);
    expect(skill?.usage?.wins ?? 0).toBe(0);

    rmSync(join(stateDir, "ops", "waveplans.jsonl"));
    const persist = vi.fn(async (_i: PersistSkillOutcomesInput) => ({ processedWaves: 0, recordedOutcomes: 0, newlyDeprecated: [] }));
    await runPlaybook(repo, stateDir, "pb-skilled", { runWave: fakeRunWave({ verified: true, delta: 1, at: 5_000 }), persistOutcomes: persist, log: () => undefined, now: () => 6_000 });
    expect(persist).not.toHaveBeenCalled();

    writeWaveplan("demo-skilled", 7_000, ["demo-writing"]);
    const boom = vi.fn(async (_i: PersistSkillOutcomesInput) => { throw new Error("registry locked"); });
    const lines: string[] = [];
    const entry = await runPlaybook(repo, stateDir, "pb-skilled", { runWave: fakeRunWave({ verified: true, delta: 1, at: 8_000 }), persistOutcomes: boom, log: (l) => { lines.push(l); }, now: () => 9_000 });
    expect(entry.outcome).toBe("ran");
    expect(lines.some((l) => l.includes("技能战绩写回失败"))).toBe(true);
  });
});