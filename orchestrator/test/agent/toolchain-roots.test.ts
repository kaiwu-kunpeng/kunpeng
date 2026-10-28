import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectToolchainWritableRoots } from "../../src/agent/toolchain-roots.js";

let root: string;
beforeEach(() => { root = realpathSync(mkdtempSync(join(tmpdir(), "kp-tc-roots-"))); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe("worktree 软链工具链目录 → 可写根（作者锁定）", () => {
  it("收集仓根与一级子目录里指向 cwd 之外的 node_modules/dist 软链目标；真实目录、隐藏目录、cwd 内软链不收", () => {
    const main = join(root, "main");
    const wt = join(root, "wt");
    mkdirSync(join(main, "node_modules"), { recursive: true });
    mkdirSync(join(main, "orchestrator", "node_modules"), { recursive: true });
    mkdirSync(join(main, "orchestrator", "dist"), { recursive: true });
    mkdirSync(join(wt, "orchestrator"), { recursive: true });
    mkdirSync(join(wt, ".hidden"), { recursive: true });
    mkdirSync(join(wt, "docs", "dist"), { recursive: true });              // 真实目录：不收
    mkdirSync(join(wt, "local-target"), { recursive: true });
    symlinkSync(join(main, "node_modules"), join(wt, "node_modules"), "dir");
    symlinkSync(join(main, "orchestrator", "node_modules"), join(wt, "orchestrator", "node_modules"), "dir");
    symlinkSync(join(main, "orchestrator", "dist"), join(wt, "orchestrator", "dist"), "dir");
    symlinkSync(join(main, "node_modules"), join(wt, ".hidden", "node_modules"), "dir"); // 隐藏目录：不收
    symlinkSync(join(wt, "local-target"), join(wt, "dist"), "dir");        // 指向 cwd 内：不收

    expect(collectToolchainWritableRoots(wt)).toEqual([
      join(main, "node_modules"),
      join(main, "orchestrator", "dist"),
      join(main, "orchestrator", "node_modules"),
    ]);
  });

  it("没有软链或 cwd 不存在 → 空数组，不抛", () => {
    const plain = join(root, "plain");
    mkdirSync(join(plain, "node_modules"), { recursive: true });
    expect(collectToolchainWritableRoots(plain)).toEqual([]);
    expect(collectToolchainWritableRoots(join(root, "nope"))).toEqual([]);
  });
});