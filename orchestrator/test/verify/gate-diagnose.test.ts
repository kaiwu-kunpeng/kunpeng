import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isBlankOutput, diagnoseBlankFailure } from "../../src/verify/gate.js";

let dirs: string[] = [];
function tmp(): string { const d = mkdtempSync(join(tmpdir(), "kp-diag-")); dirs.push(d); return d; }
afterEach(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); dirs = []; });

describe("isBlankOutput", () => {
  it("纯空白/空串 → true，有内容 → false", () => {
    expect(isBlankOutput("")).toBe(true);
    expect(isBlankOutput("  \n\t ")).toBe(true);
    expect(isBlankOutput("x")).toBe(false);
  });
});

describe("diagnoseBlankFailure：空输出失败时 trace 出失败的子命令", () => {
  it("test -f 守卫挂掉 → 诊断含失败的子命令，不含短路掉的 echo", async () => {
    const out = await diagnoseBlankFailure({ cwd: tmp(), cmd: "test -f ./definitely-missing.ts && echo SHOULD_NOT_REACH" });
    expect(out).toContain("test -f"); // 失败点被 trace 出来
    expect(out).toContain("definitely-missing.ts");
    expect(out).not.toContain("SHOULD_NOT_REACH"); // && 短路，echo 没执行
  });
});
