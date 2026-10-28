// 验收锚:验证零输出时,证据必须包含 accept 重定向出去的真实输出,且不得再猜根因。
import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diagnoseBlankFailure, isBlankOutput } from "./gate.js";

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "kp-gate-diag-"));
}

describe("diagnoseBlankFailure", () => {
  it("把 > 重定向文件的内容拼进证据", async () => {
    const dir = scratch();
    try {
      const out = join(dir, "acc.txt");
      // 真实形态:测试输出被重定向进文件,命令自身 stdout 为空,后面的 grep 判定失败。
      const cmd = `printf 'PASS-MARKER-7f3a\\nfail 5\\n' > ${out} 2>&1 && grep -q "fail 0" ${out}`;
      const evidence = await diagnoseBlankFailure({ cmd, cwd: dir, timeoutMs: 30_000 });
      expect(evidence).toContain("PASS-MARKER-7f3a");
      expect(evidence).toContain("fail 5");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("覆盖 >> 追加重定向", async () => {
    const dir = scratch();
    try {
      const out = join(dir, "append.txt");
      const cmd = `printf 'APPEND-MARKER-b21c\\n' >> ${out} 2>&1 && grep -q "never-there" ${out}`;
      const evidence = await diagnoseBlankFailure({ cmd, cwd: dir, timeoutMs: 30_000 });
      expect(evidence).toContain("APPEND-MARKER-b21c");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("多个重定向文件都要出现在证据里", async () => {
    const dir = scratch();
    try {
      const a = join(dir, "a.txt");
      const b = join(dir, "b.txt");
      const cmd =
        `printf 'FIRST-MARKER-11aa\\n' > ${a} 2>&1 && ` +
        `printf 'SECOND-MARKER-22bb\\n' > ${b} 2>&1 && ` +
        `grep -q "no-such-line" ${b}`;
      const evidence = await diagnoseBlankFailure({ cmd, cwd: dir, timeoutMs: 30_000 });
      expect(evidence).toContain("FIRST-MARKER-11aa");
      expect(evidence).toContain("SECOND-MARKER-22bb");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("不再猜根因:证据里不得出现对实现命名/路径的断言", async () => {
    const dir = scratch();
    try {
      const out = join(dir, "acc.txt");
      const cmd = `printf 'x\\n' > ${out} 2>&1 && grep -q "y" ${out}`;
      const evidence = await diagnoseBlankFailure({ cmd, cwd: dir, timeoutMs: 30_000 });
      expect(evidence).not.toContain("实现命名/路径与 spec 不符");
      expect(evidence).not.toContain("多半");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("仍然保留执行到的最后几条子命令 trace", async () => {
    const dir = scratch();
    try {
      const out = join(dir, "acc.txt");
      const cmd = `printf 'z\\n' > ${out} 2>&1 && grep -q "absent-token-9c4e" ${out}`;
      const evidence = await diagnoseBlankFailure({ cmd, cwd: dir, timeoutMs: 30_000 });
      expect(evidence).toContain("absent-token-9c4e");
      expect(evidence.split("\n").some((line) => line.startsWith("+"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("重定向目标不存在时不抛异常,照常给出 trace", async () => {
    const dir = scratch();
    try {
      const missing = join(dir, "nope", "deep", "gone.txt");
      const cmd = `test -f ${missing} && cat ${missing} > ${missing}.copy`;
      const evidence = await diagnoseBlankFailure({ cmd, cwd: dir, timeoutMs: 30_000 });
      expect(typeof evidence).toBe("string");
      expect(evidence.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("空文件被跳过,不产生空洞的标题块", async () => {
    const dir = scratch();
    try {
      const empty = join(dir, "empty.txt");
      writeFileSync(empty, "");
      const cmd = `: > ${empty} && grep -q "anything" ${empty}`;
      const evidence = await diagnoseBlankFailure({ cmd, cwd: dir, timeoutMs: 30_000 });
      expect(evidence).not.toContain("empty.txt\n\n\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("超大文件只取尾部,证据不得失控", async () => {
    const dir = scratch();
    try {
      const big = join(dir, "big.txt");
      const cmd = `seq 1 5000 > ${big} 2>&1 && grep -q "line-not-present" ${big}`;
      const evidence = await diagnoseBlankFailure({ cmd, cwd: dir, timeoutMs: 30_000 });
      expect(evidence).toContain("5000");
      expect(evidence).not.toContain("\n1\n");
      expect(evidence.split("\n").length).toBeLessThan(200);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("isBlankOutput 的行为没有被顺手改动", () => {
    expect(isBlankOutput("")).toBe(true);
    expect(isBlankOutput("   \n\t ")).toBe(true);
    expect(isBlankOutput("x")).toBe(false);
  });
});