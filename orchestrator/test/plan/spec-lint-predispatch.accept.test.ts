import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import { existenceAnchors, lintSpecText, vitestNamedFiles } from "../../src/plan/spec-lint.js";

const F = "`".repeat(3);
const GOOD_TEST = 'import { expect, it } from "vitest";\nit("a", () => { expect(1).toBe(1); });';
const ENV = "env -u KUNPENG_BACKEND";

let repo: string;
beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "kp-predispatch-"));
  mkdirSync(join(repo, "orchestrator", "src"), { recursive: true });
  mkdirSync(join(repo, "orchestrator", "test"), { recursive: true });
  writeFileSync(join(repo, "orchestrator", "src", "here.ts"), "export const here = 1;\n");
  writeFileSync(join(repo, "orchestrator", "test", "existing.test.ts"), "//\n");
});

function spec(accept: string, file = GOOD_TEST, extraAllow: string[] = []): string {
  const allow = ["orchestrator/src/x.ts", "orchestrator/test/x.accept.test.ts", ...extraAllow].map((a) => `allow: ${a}`).join("\n");
  return [
    "# 派流前闸夹具", "正文", "",
    `${F}scope`, allow, F, "",
    `${F}accept-file path=orchestrator/test/x.accept.test.ts`, file, F, "",
    `${F}accept`, accept, F, "",
  ].join("\n");
}
const codes = (md: string) => lintSpecText(md, repo).map((i) => `${i.level}:${i.code}`);

describe("命令解析（作者锁定）", () => {
  test("只收 vitest 段里点名的测试文件", () => {
    expect(vitestNamedFiles("cd orchestrator && npx tsc --noEmit && env -u X npx vitest run test/a.test.ts test/b/c.accept.test.ts && grep -q x d.test.ts"))
      .toEqual(["test/a.test.ts", "test/b/c.accept.test.ts"]);
  });
  test("收 test -f / test -e 的路径", () => {
    expect(existenceAnchors("test -f orchestrator/src/a.ts && test -e docs/b.md && cd x")).toEqual(["orchestrator/src/a.ts", "docs/b.md"]);
  });
});

describe("派流前确定性闸的新规则（作者锁定）", () => {
  test("干净 spec：新规则一条都不报", () => {
    const md = spec(`cd orchestrator && ${ENV} npx vitest run test/x.accept.test.ts test/existing.test.ts`);
    expect(codes(md).filter((c) => /accept-(test|anchor|vitest|file-syntax)/.test(c))).toEqual([]);
  });

  test("点名的测试文件不在盘上、不是验收件、不在 scope → error accept-test-missing", () => {
    expect(codes(spec(`cd orchestrator && ${ENV} npx vitest run test/nope/y.test.ts`))).toContain("error:accept-test-missing");
  });

  test("点名的测试文件在 scope allow 里但没锁定 → 只 warn accept-test-unlocked", () => {
    const out = codes(spec(`cd orchestrator && ${ENV} npx vitest run test/new-one.test.ts`, GOOD_TEST, ["orchestrator/test/new-one.test.ts"]));
    expect(out).toContain("warn:accept-test-unlocked");
    expect(out).not.toContain("error:accept-test-missing");
  });

  test("test -f 断言的文件不存在也不会被创建 → error accept-anchor-missing", () => {
    const md = spec(`test -f orchestrator/src/ghost.ts && cd orchestrator && ${ENV} npx vitest run test/x.accept.test.ts`);
    expect(codes(md)).toContain("error:accept-anchor-missing");
  });

  test("test -f 断言的文件已存在、或在 scope allow 内 → 不报", () => {
    const md = spec(`test -f orchestrator/src/here.ts && test -f orchestrator/src/x.ts && cd orchestrator && ${ENV} npx vitest run test/x.accept.test.ts`);
    expect(codes(md)).not.toContain("error:accept-anchor-missing");
  });

  test("验收件 TS 语法错误（括号没闭合）→ error accept-file-syntax", () => {
    const md = spec(`cd orchestrator && ${ENV} npx vitest run test/x.accept.test.ts`, 'import { it } from "vitest";\nit("a", () => {');
    expect(codes(md)).toContain("error:accept-file-syntax");
  });

  test("围栏粘在验收件最后一行 → 残留的三反引号被语法检查抓住", () => {
    const md = spec(`cd orchestrator && ${ENV} npx vitest run test/x.accept.test.ts`, GOOD_TEST + F);
    expect(codes(md)).toContain("error:accept-file-syntax");
  });

  test("行中间出现三反引号字面量（字符串里）不算错", () => {
    const md = spec(`cd orchestrator && ${ENV} npx vitest run test/x.accept.test.ts`, `const fence = "${F}aop";\n${GOOD_TEST}`);
    expect(codes(md)).not.toContain("error:accept-file-syntax");
  });

  test("跑 vitest 却没 env -u KUNPENG_BACKEND → warn", () => {
    expect(codes(spec("cd orchestrator && npx vitest run test/x.accept.test.ts"))).toContain("warn:accept-vitest-backend-env");
  });
});