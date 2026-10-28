import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureFlowTmpDir, flowTmpDir, removeFlowTmpDir } from "../../src/runtime/flow-tmp.js";

let base: string;
beforeEach(() => { base = mkdtempSync(join(tmpdir(), "kp-flow-tmp-")); });
afterEach(() => { rmSync(base, { recursive: true, force: true }); });

describe("每流独立 tmp（作者锁定）", () => {
  it("路径 = <base>/kunpeng-flows/<worktree basename>；两个 worktree 互不相同", () => {
    expect(flowTmpDir("/r/.kunpeng/wt/flow-a-0-0", base)).toBe(join(base, "kunpeng-flows", "flow-a-0-0"));
    expect(flowTmpDir("/r/.kunpeng/wt/flow-b-0-0", base)).not.toBe(flowTmpDir("/r/.kunpeng/wt/flow-a-0-0", base));
    expect(flowTmpDir("/r/.kunpeng/wt/flow-a-0-0")).toContain(join("kunpeng-flows", "flow-a-0-0"));
  });

  it("ensure 建目录并返回路径；remove 删掉；重复 remove 不抛", async () => {
    const p = ensureFlowTmpDir("/r/.kunpeng/wt/flow-a-0-0", base);
    expect(existsSync(p)).toBe(true);
    expect(ensureFlowTmpDir("/r/.kunpeng/wt/flow-a-0-0", base)).toBe(p);
    await removeFlowTmpDir("/r/.kunpeng/wt/flow-a-0-0", base);
    expect(existsSync(p)).toBe(false);
    await expect(removeFlowTmpDir("/r/.kunpeng/wt/flow-a-0-0", base)).resolves.toBeUndefined();
  });
});