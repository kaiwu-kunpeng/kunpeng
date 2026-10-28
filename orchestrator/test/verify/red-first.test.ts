import { describe, expect, it } from "vitest";
import { NOT_RED_FIRST_KIND, formatNotRedFirst, parseShortStat, resolveRedFirst } from "../../src/verify/red-first.js";

describe("先红核查辅助函数（作者锁定）", () => {
  it("resolveRedFirst：未设置/其它值开，0/off/false 关", () => {
    expect(resolveRedFirst({})).toBe(true);
    expect(resolveRedFirst({ KUNPENG_RED_FIRST: "1" })).toBe(true);
    expect(resolveRedFirst({ KUNPENG_RED_FIRST: "yes" })).toBe(true);
    expect(resolveRedFirst({ KUNPENG_RED_FIRST: "0" })).toBe(false);
    expect(resolveRedFirst({ KUNPENG_RED_FIRST: " OFF " })).toBe(false);
    expect(resolveRedFirst({ KUNPENG_RED_FIRST: "false" })).toBe(false);
  });

  it("parseShortStat：三段任一可缺，空串全 0", () => {
    expect(parseShortStat(" 3 files changed, 12 insertions(+), 4 deletions(-)\n")).toEqual({ files: 3, insertions: 12, deletions: 4 });
    expect(parseShortStat(" 1 file changed, 1 insertion(+)")).toEqual({ files: 1, insertions: 1, deletions: 0 });
    expect(parseShortStat(" 2 files changed, 7 deletions(-)")).toEqual({ files: 2, insertions: 0, deletions: 7 });
    expect(parseShortStat("")).toEqual({ files: 0, insertions: 0, deletions: 0 });
    expect(parseShortStat("garbage")).toEqual({ files: 0, insertions: 0, deletions: 0 });
  });

  it("回滚 kind 与文案固定", () => {
    expect(NOT_RED_FIRST_KIND).toBe("not-red-first");
    expect(formatNotRedFirst(0)).toBe("验收在实现前已通过（没先红，exit=0）：作者测试/验收命令没有锁住目标，实现前后无差别");
  });
});