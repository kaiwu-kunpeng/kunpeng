import { describe, expect, test } from "vitest";
import { auditAcceptanceTest } from "../src/loop/audit.js";

const strongOf = async (cmd: string): Promise<boolean> => (await auditAcceptanceTest(cmd)).strong;

describe("验收测试审计必须 fail-closed", () => {
  test("恒真/空壳命令一律判弱", async () => {
    for (const cmd of ["echo ok", "exit 0", "/bin/true", "true", ":", ""]) {
      expect(await strongOf(cmd), `期望判弱: ${cmd}`).toBe(false);
    }
  });

  test("构建/类型检查单独出现不算验收", async () => {
    for (const cmd of ["npm run build", "npx tsc --noEmit", "pnpm build"]) {
      expect(await strongOf(cmd), `期望判弱: ${cmd}`).toBe(false);
    }
  });

  test("常见测试运行器判强", async () => {
    for (const cmd of ["npm test", "npm run test:unit", "pytest -q", "go test ./...", "cargo test", "yarn test"]) {
      expect(await strongOf(cmd), `期望判强: ${cmd}`).toBe(true);
    }
  });

  test("内容/断言级信号判强", async () => {
    for (const cmd of ['grep -q "foo" out.txt', '[ "$a" == "$b" ]', "cmp -s a b"]) {
      expect(await strongOf(cmd), `期望判强: ${cmd}`).toBe(true);
    }
  });

  test("存在性检查保留原有诊断文案，不被默认分支吞掉", async () => {
    const r = await auditAcceptanceTest("test -f src/x.ts");
    expect(r.strong).toBe(false);
    expect(r.reason).toContain("存在性");
  });

  test("默认判弱的文案必须点明 fail-closed 与 C3", async () => {
    const r = await auditAcceptanceTest("npm run build");
    expect(r.strong).toBe(false);
    expect(r.reason).toContain("fail-closed");
    expect(r.reason).toContain("C3");
  });

  test("vitest 点名不存在的测试文件仍判弱且文案不变", async () => {
    const r = await auditAcceptanceTest("npx vitest run src/definitely-missing-abc.test.ts");
    expect(r.strong).toBe(false);
    expect(r.reason).toContain("不存在");
  });
});