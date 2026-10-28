import { describe, expect, it } from "vitest";
import { lintSpecText } from "../src/plan/spec-lint.js";

const good = "```scope\nallow: orchestrator/src/a.ts\nallow: orchestrator/test/a.test.ts\n```\n\n# 标题\n正文\n\n```accept\ntest -f orchestrator/src/a.ts && cd orchestrator && npx vitest run test/a.test.ts\n```\n\n```accept-file path=orchestrator/test/a.test.ts\nimport { it, expect } from \"vitest\";\nit(\"x\", () => { expect(1).toBe(1); });\n```\n";

describe("spec lint 门(作者验收)", () => {
  it("好 spec 零 error", () => {
    expect(lintSpecText(good).filter((i) => i.level === "error").length).toBe(0);
  });
  it("YAML 列表写法的 scope 判 error", () => {
    const bad = good.replace("allow: orchestrator/src/a.ts\nallow: orchestrator/test/a.test.ts", "allow:\n  - orchestrator/src/a.ts");
    const issues = lintSpecText(bad);
    expect(issues.some((i) => i.level === "error" && (i.code === "scope-empty" || i.code === "scope-line-invalid"))).toBe(true);
  });
  it("accept fence 未收尾判 error", () => {
    const bad = good.slice(0, good.lastIndexOf("```"));
    expect(lintSpecText(bad).some((i) => i.code === "fence-unterminated")).toBe(true);
  });
  it("无 accept 的 flow 判 error", () => {
    const bad = "```scope\nallow: a.ts\n```\n\n# 只有标题没有验收\n正文\n";
    expect(lintSpecText(bad).some((i) => i.code === "accept-missing")).toBe(true);
  });
  it("accept-file 缺 path 判 error", () => {
    const bad = good.replace("```accept-file path=orchestrator/test/a.test.ts", "```accept-file");
    expect(lintSpecText(bad).some((i) => i.code === "accept-file-no-path")).toBe(true);
  });
});