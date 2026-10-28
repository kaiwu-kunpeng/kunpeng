import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractTestFiles, missingTestFiles } from "../../src/loop/audit.js";

let probe: string;

beforeEach(() => {
  probe = mkdtempSync(join(tmpdir(), "kp-audit-nl-"));
  mkdirSync(join(probe, "orchestrator", "test"), { recursive: true });
  writeFileSync(join(probe, "orchestrator", "test", "real.test.ts"), "//\n");
});

afterEach(() => rmSync(probe, { recursive: true, force: true }));

describe("多行 accept：独占一行的 cd 必须被建模（误报侧）", () => {
  it("首行是 set -e 时，后面独占一行的 cd 生效 → 存在的文件不再被误判成缺失", () => {
    const cmd = "set -e\ncd orchestrator\nnpx vitest run test/real.test.ts";
    expect(missingTestFiles(cmd, probe)).toEqual([]);
  });
});

describe("多行 accept：首行就是 cd 时守门员不得被静默关掉（漏报侧）", () => {
  it("首行就是 cd，点名的幽灵文件必须被点出来", () => {
    const cmd = "cd orchestrator\nnpx vitest run test/ghost.test.ts";
    expect(missingTestFiles(cmd, probe)).toEqual(["test/ghost.test.ts"]);
  });

  it("首行就是 cd，两个幽灵文件都要被点出来", () => {
    const cmd = "cd orchestrator\nnpx vitest run test/g1.test.ts test/g2.test.ts";
    expect(missingTestFiles(cmd, probe)).toEqual(["test/g1.test.ts", "test/g2.test.ts"]);
  });

  it("多级 cd 逐段累积，路径按最终目录解析", () => {
    const cmd = "cd orchestrator\ncd test\nnpx vitest run ghost.test.ts";
    expect(missingTestFiles(cmd, probe)).toEqual(["ghost.test.ts"]);
    expect(missingTestFiles("cd orchestrator\ncd test\nnpx vitest run real.test.ts", probe)).toEqual([]);
  });
});

describe("既有单行写法逐字不变（回归）", () => {
  it("cd x && vitest 仍然正确", () => {
    expect(missingTestFiles("cd orchestrator && npx vitest run test/real.test.ts", probe)).toEqual([]);
    expect(missingTestFiles("cd orchestrator && npx vitest run test/ghost.test.ts", probe)).toEqual(["test/ghost.test.ts"]);
  });

  it("不点名测试文件的自包含命令仍判空", () => {
    expect(missingTestFiles('node -e "process.exit(0)"', probe)).toEqual([]);
  });
});

describe("换行的边界", () => {
  it("反斜杠续行不算命令分隔：跨行写的 vitest 调用仍被检查", () => {
    const cmd = "cd orchestrator\nnpx vitest run \\\n  test/ghost.test.ts";
    expect(missingTestFiles(cmd, probe)).toEqual(["test/ghost.test.ts"]);
  });

  it("引号内的换行不算分隔：node -e 的多行脚本不被切碎，里面的诱饵路径不被误收", () => {
    const cmd = 'cd orchestrator\nnode -e "cd /nowhere;\nvitest run test/decoy.test.ts"\nnpx vitest run test/ghost.test.ts';
    expect(missingTestFiles(cmd, probe)).toEqual(["test/ghost.test.ts"]);
  });

  it("extractTestFiles 在多行下抽全部点名文件且保序去重", () => {
    const cmd = "cd orchestrator\nnpx vitest run test/a.test.ts test/b.test.ts\nnpx vitest run test/a.test.ts";
    expect(extractTestFiles(cmd)).toEqual(["test/a.test.ts", "test/b.test.ts"]);
  });
});