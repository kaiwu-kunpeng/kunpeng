import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acceptStageWithCheckpoint } from "../../src/product/loop-orchestrate.js";
import { writeLoopState } from "../../src/product/loop-store.js";
import { initState } from "../../src/product/stage-machine.js";
import { listCheckpoints } from "../../src/product/loop-checkpoint.js";

const NOW = 1_800_000_000_000;
const def = { idea: "演示", problem: "p", jobStatement: "j", users: ["u"], stories: ["s"], acceptance: ["a"], nonGoals: [] };

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "kp-ckpt-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe("acceptStageWithCheckpoint", () => {
  it("接受阶段前自动存档，状态照常推进", async () => {
    await writeLoopState(root, initState("demo", "演示", NOW));
    const dir = join(root, ".kunpeng", "product", "demo");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "definition.md"), "# 定义");
    const st = await acceptStageWithCheckpoint(root, "demo", "define", def, NOW + 1);
    expect(st).toBeTruthy();
    const ckpts = await listCheckpoints(root, "demo");
    expect(ckpts.length).toBeGreaterThanOrEqual(1);
    expect(ckpts.map((c) => c.label).join()).toContain("自动存");
  });
  it("无状态时不炸（存档吞错，acceptAndAdvance 语义不变）", async () => {
    const st = await acceptStageWithCheckpoint(root, "ghost", "define", def, NOW);
    expect(st).toBeUndefined();
  });
});