import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { buildAutopilotGuards } from "../../src/server/autopilot-guards.js";
import { FlowTracker } from "../../src/runtime/flowstate.js";

const execFileAsync = promisify(execFile);

/** 真 git 仓：main 一份文件，kp/flow-x 改了它。 */
async function makeRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "kp-public-surface-"));
  const git = (...args: string[]) => execFileAsync("git", args, { cwd: dir });
  await git("init", "-b", "main");
  await git("config", "user.email", "t@example.com");
  await git("config", "user.name", "t");
  await mkdir(join(dir, "lib"), { recursive: true });
  await writeFile(join(dir, "lib", "calc.ts"), "export const a = 1;\n");
  await git("add", "lib/calc.ts");
  await git("commit", "-m", "base");
  await git("checkout", "-b", "kp/flow-x");
  await writeFile(join(dir, "lib", "calc.ts"), "export const a = 2;\n");
  await git("add", "lib/calc.ts");
  await git("commit", "-m", "change");
  await git("checkout", "main");
  return dir;
}

async function writeSurface(dir: string, raw: string): Promise<void> {
  await mkdir(join(dir, ".kunpeng"), { recursive: true });
  await writeFile(join(dir, ".kunpeng", "public-surface.json"), raw);
}

describe("publicSurface 配置写坏 → fail-closed（作者锁定）", () => {
  it("JSON 损坏 → publicSurface 抛错，信息点名 public-surface.json", async () => {
    const dir = await makeRepo();
    await writeSurface(dir, "{ 这不是 json");
    const guards = buildAutopilotGuards(dir, new FlowTracker(join(dir, ".kunpeng", "state")));
    await expect(guards.publicSurface("flow-x", "main")).rejects.toThrow(/public-surface\.json/);
  });

  it("JSON 损坏 → tier 按触及对外面处理，转人审", async () => {
    const dir = await makeRepo();
    await writeSurface(dir, "{ 这不是 json");
    const tracker = new FlowTracker(join(dir, ".kunpeng", "state"));
    await tracker.start("flow-x", "改 calc");
    await tracker.setAcceptEvidence("flow-x", { baseline: { passed: false, exitCode: 1, at: 1, attempt: 1, logPath: "/tmp/x" } });
    const guards = buildAutopilotGuards(dir, tracker);
    const verdict = await guards.tier("flow-x", "main");
    expect(verdict.ruleIds.some((id) => /public-surface/.test(id))).toBe(true);
    expect(verdict.tier).toBe("human");
  });

  it("同一仓 JSON 合法且不命中 → tier 不因对外面转人审", async () => {
    const dir = await makeRepo();
    await writeSurface(dir, JSON.stringify({ patterns: ["site/**"] }));
    const tracker = new FlowTracker(join(dir, ".kunpeng", "state"));
    await tracker.start("flow-x", "改 calc");
    await tracker.setAcceptEvidence("flow-x", { baseline: { passed: false, exitCode: 1, at: 1, attempt: 1, logPath: "/tmp/x" } });
    const guards = buildAutopilotGuards(dir, tracker);
    const verdict = await guards.tier("flow-x", "main");
    expect(verdict.ruleIds.some((id) => /public-surface/.test(id))).toBe(false);
  });

  it("没有 public-surface.json → 仍然不命中", async () => {
    const dir = await makeRepo();
    const guards = buildAutopilotGuards(dir, new FlowTracker(join(dir, ".kunpeng", "state")));
    await expect(guards.publicSurface("flow-x", "main")).resolves.toEqual({ touched: false });
  });
});