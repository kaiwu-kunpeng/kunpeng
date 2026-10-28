import { describe, it, expect } from "vitest";
import { selectRelevantPaths } from "../../src/context/path-select.js";

describe("selectRelevantPaths", () => {
  it("路径相关文件即便排末尾也必入选(治 cap 漏文件)", () => {
    const paths = ["z/aaa.ts", "z/bbb.ts", "src/metrics/escape-rate.ts"];
    const sel = selectRelevantPaths(paths, "给 src/metrics/escape-rate.ts 加东西", 2);
    expect(sel).toContain("src/metrics/escape-rate.ts");
    expect(sel.length).toBeLessThanOrEqual(2);
    expect(sel[0]).toBe("src/metrics/escape-rate.ts"); // 相关排第一
  });
  it("无相关词 → 保持原序、cap 截断", () => {
    const sel = selectRelevantPaths(["a.ts", "b.ts", "c.ts"], "毫不相关 nothing", 2);
    expect(sel).toEqual(["a.ts", "b.ts"]);
  });
  it("cap 大于总数 → 返回全部(相关在前)", () => {
    const sel = selectRelevantPaths(["a/x.ts", "metrics/escape-rate.ts"], "改 escape-rate.ts", 10);
    expect(sel.length).toBe(2);
    expect(sel[0]).toBe("metrics/escape-rate.ts");
  });
  it("cap<=0 → 空", () => {
    expect(selectRelevantPaths(["a.ts"], "x", 0)).toEqual([]);
  });
  it("多相关：score 高的更靠前", () => {
    // 'escape-rate' 命中 escape-rate.ts 的 escape-rate/escape/rate 三词;rate-only.ts 只命中 rate
    const sel = selectRelevantPaths(["x/rate-only.ts", "y/escape-rate.ts", "z/none.ts"], "改 escape-rate.ts 的 rate", 3);
    expect(sel[0]).toBe("y/escape-rate.ts");
    expect(sel.indexOf("z/none.ts")).toBe(2);
  });
});
