import { describe, expect, test } from "vitest";
import { clientScript } from "../../src/server/ui/client.js";

/** 从 clientScript 里按名字抠出一个具名函数,独立 eval 后返回它。 */
function loadFn(name: string): (...args: unknown[]) => unknown {
  const at = clientScript.indexOf(`function ${name}(`);
  if (at < 0) throw new Error(`clientScript 里找不到 ${name}`);
  let depth = 0;
  let started = false;
  let end = -1;
  for (let i = at; i < clientScript.length; i += 1) {
    const ch = clientScript[i];
    if (ch === "{") { depth += 1; started = true; }
    else if (ch === "}") { depth -= 1; if (started && depth === 0) { end = i + 1; break; } }
  }
  if (end < 0) throw new Error(`${name} 函数体括号不闭合`);
  return new Function(`${clientScript.slice(at, end)}; return ${name};`)() as (...args: unknown[]) => unknown;
}

/** 取 localfs 读分支那段源码。 */
function readBranch(): string {
  const at = clientScript.indexOf('if (op.kind === "read")');
  if (at < 0) throw new Error("clientScript 里找不到 localfs read 分支");
  return clientScript.slice(at, at + 2000);
}

describe("localfs 读 Office 走本地抽取", () => {
  test("clientScript 语法有效(防 SPA 崩)", () => {
    expect(() => new Function(clientScript)).not.toThrow();
  });

  test("kpOfficeName 只认 docx/pptx/xlsx", () => {
    const kpOfficeName = loadFn("kpOfficeName");
    expect(kpOfficeName("方案.pptx")).toBe(true);
    expect(kpOfficeName("报告.DOCX")).toBe(true);
    expect(kpOfficeName("表.xlsx")).toBe(true);
    expect(kpOfficeName("扫描件.pdf")).toBe(false);
    expect(kpOfficeName("图.png")).toBe(false);
    expect(kpOfficeName("笔记.txt")).toBe(false);
    expect(kpOfficeName("")).toBe(false);
  });

  test("read 分支里接上了 Office 抽取", () => {
    const branch = readBranch();
    expect(branch).toContain("kpOfficeName");
    expect(branch).toContain("kpOfficeExtract");
  });

  test("抽取必须排在 5MB 二进制上限判断之前", () => {
    const branch = readBranch();
    const extractAt = branch.indexOf("kpOfficeExtract");
    const limitAt = branch.indexOf("binaryReadLimit");
    expect(extractAt).toBeGreaterThanOrEqual(0);
    expect(limitAt).toBeGreaterThanOrEqual(0);
    expect(extractAt).toBeLessThan(limitAt);
  });

  test("原有二进制与文本兜底路径都还在(防回归)", () => {
    const branch = readBranch();
    expect(branch).toContain("localfsIsBinary");
    expect(branch).toContain("binaryReadLimit");
    expect(branch).toContain("textReadLimit");
    expect(clientScript).toContain("超过 5MB 读取上限");
  });

  test("三个体积常量取值未被改动", () => {
    expect(clientScript).toContain("2097152");
    expect(clientScript).toContain("5242880");
    expect(clientScript).toContain("10485760");
  });
});