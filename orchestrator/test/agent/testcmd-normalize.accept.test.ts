import { describe, expect, test } from "vitest";
import { normalizeTestCmd, parseTestCmdLine } from "../../src/agent/testcmd.js";
import { resolveRunAcceptance } from "../../src/cli-commands/devcycle.js";

describe("normalizeTestCmd（作者锁定）", () => {
  test("剥一层外层反引号", () => {
    expect(normalizeTestCmd("`set -e; cd orchestrator; npm test`")).toBe("set -e; cd orchestrator; npm test");
    expect(normalizeTestCmd("  `npm test`  ")).toBe("npm test");
    expect(normalizeTestCmd("```npm run lint && npm test```")).toBe("npm run lint && npm test");
    expect(normalizeTestCmd("``` npm test ```")).toBe("npm test");
  });
  test("不该动的不动", () => {
    expect(normalizeTestCmd("npm test")).toBe("npm test");
    expect(normalizeTestCmd("  npm test  ")).toBe("npm test");
    expect(normalizeTestCmd("echo `date` && npm test")).toBe("echo `date` && npm test");
    expect(normalizeTestCmd("`a` && `b`")).toBe("`a` && `b`");
    expect(normalizeTestCmd("`npm test")).toBe("`npm test");
    expect(normalizeTestCmd("`")).toBe("`");
    expect(normalizeTestCmd("``")).toBe("``");
    expect(normalizeTestCmd("``````")).toBe("``````");
  });
  test("三反引号：只看两端，内部含三反引号也照剥一层", () => {
    expect(normalizeTestCmd("```a ``` b```")).toBe("a ``` b");
    expect(normalizeTestCmd("````x````")).toBe("`x`");
  });
});

describe("parseTestCmdLine（作者锁定）", () => {
  test("取最后一条、剥反引号、空串视为没有", () => {
    expect(parseTestCmdLine("说明\nTESTCMD: npm run a\n更多\nTESTCMD: `npm test`\n")).toBe("npm test");
    expect(parseTestCmdLine("TESTCMD: ` `")).toBeUndefined();
    expect(parseTestCmdLine("TESTCMD: ```   ```")).toBeUndefined();
    expect(parseTestCmdLine("没有测试命令")).toBeUndefined();
    expect(parseTestCmdLine("  TESTCMD:   npm test  ")).toBe("npm test");
  });
});

describe("resolveRunAcceptance（作者锁定）", () => {
  const SPEC = "# 标题\n\n正文\n\n```accept\nset -e\ncd orchestrator\ntest -f a.ts\nnpx vitest run test/x.test.ts\n```\n";
  test("没传 --accept 时用 spec 里的 accept 块，原样多行", () => {
    expect(resolveRunAcceptance(undefined, SPEC)).toBe("set -e\ncd orchestrator\ntest -f a.ts\nnpx vitest run test/x.test.ts");
    expect(resolveRunAcceptance("   ", SPEC)).toBe("set -e\ncd orchestrator\ntest -f a.ts\nnpx vitest run test/x.test.ts");
  });
  test("--accept 优先", () => {
    expect(resolveRunAcceptance("npm test", SPEC)).toBe("npm test");
    expect(resolveRunAcceptance("  npm test \n", SPEC)).toBe("  npm test \n");
  });
  test("两者都没有时返回 undefined（交给 spec 阶段的 TESTCMD）", () => {
    expect(resolveRunAcceptance(undefined, "# 只有需求，没有验收块")).toBeUndefined();
  });
});