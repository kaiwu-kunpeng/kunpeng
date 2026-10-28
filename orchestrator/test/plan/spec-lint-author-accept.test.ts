import { describe, expect, test } from "vitest";
import { lintSpecText } from "../../src/plan/spec-lint.js";

const ROOT = new URL("../../..", import.meta.url).pathname;

/** 现代写法的最小 spec：scope + 作者锁定验收件 + 真跑 vitest 的 accept。 */
function spec(opts: {
  allow?: string[];
  forbid?: string[];
  acceptCmd?: string;
  authorPath?: string;
  authorBody?: string;
} = {}): string {
  const allow = opts.allow ?? ["orchestrator/src/a.ts", "orchestrator/test/plan/spec-lint-author-accept.test.ts"];
  const forbid = opts.forbid ?? [];
  const acceptCmd = opts.acceptCmd
    ?? "cd orchestrator && npx --no-install tsc --noEmit && npx --no-install vitest run test/plan/spec-lint-author-accept.test.ts";
  const authorPath = opts.authorPath ?? "orchestrator/test/plan/spec-lint-author-accept.test.ts";
  const authorBody = opts.authorBody
    ?? 'import { expect, test } from "vitest";\ntest("x", () => { expect(1).toBe(1); });';
  const scopeLines = [...allow.map((g) => `allow: ${g}`), ...forbid.map((g) => `forbid: ${g}`)].join("\n");
  return [
    "# F test spec",
    "",
    "正文说明。",
    "",
    "```scope",
    scopeLines,
    "```",
    "",
    "```accept-file path=" + authorPath,
    authorBody,
    "```",
    "",
    "```accept",
    acceptCmd,
    "```",
    "",
  ].join("\n");
}

const errors = (md: string, cwd = ROOT) => lintSpecText(md, cwd).filter((i) => i.level === "error");
const codes = (md: string, cwd = ROOT) => lintSpecText(md, cwd).map((i) => i.code);

describe("accept-weak：作者手写的验收命令也要过强度闸", () => {
  test("只有存在性检查的 accept → 判 weak error", () => {
    const md = spec({ acceptCmd: "test -f orchestrator/src/a.ts" });
    const hit = errors(md).filter((i) => i.code === "accept-weak");
    expect(hit.length).toBeGreaterThan(0);
    expect(hit[0].message).toContain("F test spec");
  });

  test("反向：tsc + vitest 跑真实存在的测试文件 → 不判 weak", () => {
    const md = spec({
      acceptCmd: "cd orchestrator && npx --no-install tsc --noEmit && npx --no-install vitest run test/cli-runner.integration.test.ts",
      authorPath: "orchestrator/src/a.ts",
      allow: ["orchestrator/src/a.ts"],
    });
    expect(codes(md)).not.toContain("accept-weak");
  });

  test("accept 点名的测试文件还不存在，但由 accept-file 声明 → 作者锁定件豁免，不判 weak", () => {
    const md = spec({
      acceptCmd: "cd orchestrator && npx --no-install vitest run test/plan/brand-new-not-on-disk.test.ts",
      authorPath: "orchestrator/test/plan/brand-new-not-on-disk.test.ts",
      allow: ["orchestrator/test/plan/brand-new-not-on-disk.test.ts"],
    });
    expect(codes(md)).not.toContain("accept-weak");
  });

  test("空 accept 仍由既有 accept-missing 负责，不重复报 weak", () => {
    const md = "# F test spec\n\n正文\n\n```scope\nallow: orchestrator/src/a.ts\n```\n";
    expect(codes(md)).toContain("accept-missing");
  });
});

describe("accept-file-outside-scope：验收件必须落在范围内", () => {
  test("验收件不在 allow 内 → error，且文案点名该文件", () => {
    const md = spec({ allow: ["orchestrator/src/a.ts"] });
    const hit = errors(md).filter((i) => i.code === "accept-file-outside-scope");
    expect(hit.length).toBeGreaterThan(0);
    expect(hit[0].message).toContain("spec-lint-author-accept.test.ts");
  });

  test("验收件命中 forbid → 同样 error", () => {
    const md = spec({
      allow: ["orchestrator/**"],
      forbid: ["orchestrator/test/plan/**"],
    });
    expect(errors(md).map((i) => i.code)).toContain("accept-file-outside-scope");
  });

  test("反向：验收件正常落在 allow 内 → 不报", () => {
    expect(codes(spec())).not.toContain("accept-file-outside-scope");
  });

  test("反向：allow 用 ** 通配也算落在范围内", () => {
    const md = spec({ allow: ["orchestrator/src/**", "orchestrator/test/**"] });
    expect(codes(md)).not.toContain("accept-file-outside-scope");
  });
});

describe("accept-contradiction-substring：负断言是正断言的子串", () => {
  const body = (extra: string) => [
    'import { expect, test } from "vitest";',
    'test("a", () => { expect(x).toContain("不要输出 TESTCMD"); });',
    extra,
  ].join("\n");

  test("命中：not.toContain 的字面量是 toContain 字面量的子串 → warn", () => {
    const md = spec({ authorBody: body('test("b", () => { expect(p).not.toContain("TESTCMD"); });') });
    const issues = lintSpecText(md, ROOT);
    const hit = issues.filter((i) => i.code === "accept-contradiction-substring");
    expect(hit.length).toBe(1);
    expect(hit[0].level).toBe("warn");
    expect(hit[0].message).toContain("TESTCMD");
    expect(hit[0].message).toContain("不要输出 TESTCMD");
  });

  test("它只是 warn，不许把 spec 拦死", () => {
    const md = spec({ authorBody: body('test("b", () => { expect(p).not.toContain("TESTCMD"); });') });
    expect(errors(md).map((i) => i.code)).not.toContain("accept-contradiction-substring");
  });

  test("反向：两个字面量完全相等 → 不报（同一断言的正反面是合法的）", () => {
    const md = spec({
      authorBody: [
        'import { expect, test } from "vitest";',
        'test("a", () => { expect(x).toContain("ABC"); });',
        'test("b", () => { expect(y).not.toContain("ABC"); });',
      ].join("\n"),
    });
    expect(codes(md)).not.toContain("accept-contradiction-substring");
  });

  test("反向：互不包含 → 不报", () => {
    const md = spec({
      authorBody: [
        'import { expect, test } from "vitest";',
        'test("a", () => { expect(x).toContain("ALPHA"); });',
        'test("b", () => { expect(y).not.toContain("BETA"); });',
      ].join("\n"),
    });
    expect(codes(md)).not.toContain("accept-contradiction-substring");
  });
});

describe("向后兼容与接线", () => {
  test("不传 cwd 仍可调用（既有调用方零改动）", () => {
    expect(() => lintSpecText(spec())).not.toThrow();
  });

  test("既有规则不回归：YAML 写法的 scope 仍判 error", async () => {
    const md = spec().replace("allow: orchestrator/src/a.ts", "allow:\n  - orchestrator/src/a.ts");
    expect(errors(md).length).toBeGreaterThan(0);
  });

  test("既有规则不回归：accept-file 缺 path 仍判 error", () => {
    const md = spec().replace(/```accept-file path=\S+/, "```accept-file");
    expect(errors(md).map((i) => i.code)).toContain("accept-file-no-path");
  });

  test("plan 真的把 repoRoot 传给了 lintSpecText", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(new URL("../../src/cli-commands/loop-core.ts", import.meta.url), "utf8");
    expect(src).toMatch(/lintSpecText\(md,\s*context\.repoRoot\)/);
  });
});