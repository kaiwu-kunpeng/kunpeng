import { describe, it, expect } from "vitest";
import { buildCheckupResponse } from "../../src/server/routes/checkup-verdict.js";

describe("buildCheckupResponse", () => {
  it("QA 未过时 ok 为 false 且 verdict 含问题数", () => {
    const out = buildCheckupResponse({
      qaOk: false, issueCount: 3, committed: true, previewStarted: true, previewUrl: "http://x",
    });
    expect(out.ok).toBe(false);
    expect(out.verdict).toContain("3");
    expect(out.verdict).toContain("问题");
  });

  it("QA 通过时 ok 为 true", () => {
    const out = buildCheckupResponse({
      qaOk: true, issueCount: 0, committed: true, previewStarted: false,
    });
    expect(out.ok).toBe(true);
    expect(out.verdict).toBe("验收通过");
  });

  it("previewUrl 缺省时不出现在键里", () => {
    const out = buildCheckupResponse({
      qaOk: true, issueCount: 0, committed: true, previewStarted: false,
    });
    expect(Object.keys(out)).not.toContain("previewUrl");
  });

  it("previewUrl 有值时原样透传", () => {
    const out = buildCheckupResponse({
      qaOk: true, issueCount: 0, committed: true, previewStarted: true, previewUrl: "http://127.0.0.1:5173",
    });
    expect(out.previewUrl).toBe("http://127.0.0.1:5173");
  });

  it("提交失败如实上报", () => {
    const out = buildCheckupResponse({
      qaOk: true, issueCount: 0, committed: false, previewStarted: false,
    });
    expect(out.committed).toBe(false);
  });
});