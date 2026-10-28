import { describe, expect, test } from "vitest";

import { extractSearchedData } from "./kb-extract.js";

describe("extractSearchedData", () => {
  test("captures assistant turn that used web", () => {
    const out = extractSearchedData([
      { role: "user", text: "查东京天气" },
      { role: "assistant", text: "今天晴", web: true },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.reason).toBe("web");
  });

  test("captures assistant turn containing a URL", () => {
    const out = extractSearchedData([
      { role: "assistant", text: "见 https://example.com/report 第3节" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.citedFrom).toBe("https://example.com/report");
    expect(out[0]?.reason).toBe("url");
  });

  test("ignores user turns and plain assistant chatter", () => {
    const out = extractSearchedData([
      { role: "user", text: "https://example.com 看这个" },
      { role: "assistant", text: "好的，明白了" },
    ]);
    expect(out).toHaveLength(0);
  });

  test("web turn with a URL yields one item, reason web, citedFrom filled", () => {
    const out = extractSearchedData([
      { role: "assistant", text: "数据见 https://a.com/x", web: true },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.reason).toBe("web");
    expect(out[0]?.citedFrom).toBe("https://a.com/x");
  });
});
