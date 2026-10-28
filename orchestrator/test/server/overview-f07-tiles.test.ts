import { describe, expect, it } from "vitest";
import {
  formatCompactTokens,
  formatF07TokenTile,
  f07TokenTileTitle,
  renderEscapeRateSlot,
} from "../../src/server/ui/views/overview.js";
import { part06 } from "../../src/server/ui/client-parts/part06.js";

describe("formatCompactTokens", () => {
  it("小于一百万保持精确千分位", () => {
    expect(formatCompactTokens(0)).toBe("0");
    expect(formatCompactTokens(999)).toBe("999");
    expect(formatCompactTokens(1000)).toBe("1,000");
    expect(formatCompactTokens(999999)).toBe("999,999");
  });

  it("百万到十亿之间用 M,一位小数", () => {
    expect(formatCompactTokens(1000000)).toBe("1.0M");
    expect(formatCompactTokens(141135111)).toBe("141.1M");
    expect(formatCompactTokens(2500000)).toBe("2.5M");
  });

  it("进位到 1000.0M 时必须升级成 B,不许输出 1000.0M", () => {
    expect(formatCompactTokens(999999999)).toBe("1.0B");
    expect(formatCompactTokens(1000000000)).toBe("1.0B");
    expect(formatCompactTokens(2340000000)).toBe("2.3B");
  });

  it("非法值与负数一律 0", () => {
    expect(formatCompactTokens(Number.NaN)).toBe("0");
    expect(formatCompactTokens(Number.POSITIVE_INFINITY)).toBe("0");
    expect(formatCompactTokens(-5)).toBe("0");
  });
});

describe("formatF07TokenTile", () => {
  it("线上那个数:紧凑写法 + 不换行空格 + 上升箭头", () => {
    expect(formatF07TokenTile(141135111, "up")).toBe("141.1M ↑");
  });

  it("三种趋势符号映射", () => {
    expect(formatF07TokenTile(1000, "down")).toBe("1,000 ↓");
    expect(formatF07TokenTile(1000, "flat")).toBe("1,000 →");
    expect(formatF07TokenTile(1000, "up")).toBe("1,000 ↑");
  });

  it("趋势缺失或非法一律退化成 →,不抛错", () => {
    expect(formatF07TokenTile(0, undefined)).toBe("0 →");
    expect(formatF07TokenTile(12, "wat")).toBe("12 →");
  });

  it("非有限数字的数字部分是 0", () => {
    expect(formatF07TokenTile(Number.NaN, "up")).toBe("0 ↑");
    expect(formatF07TokenTile(Number.POSITIVE_INFINITY, "flat")).toBe("0 →");
  });

  it("返回串里绝不含普通空格(否则箭头会折行)", () => {
    for (const trend of ["up", "down", "flat", undefined]) {
      expect(formatF07TokenTile(141135111, trend)).not.toContain(" ");
    }
  });

  it("紧凑写法比千分位窄:字符数必须显著减少(装不进卡片正是本次根因)", () => {
    expect(formatF07TokenTile(141135111, "up").length).toBeLessThan(
      `${(141135111).toLocaleString("en-US")} ↑`.length,
    );
  });
});

describe("f07TokenTileTitle", () => {
  it("悬停显示精确千分位,不带单位与箭头", () => {
    expect(f07TokenTileTitle(141135111)).toBe("141,135,111");
    expect(f07TokenTileTitle(0)).toBe("0");
  });

  it("非法值与负数一律 0", () => {
    expect(f07TokenTileTitle(Number.NaN)).toBe("0");
    expect(f07TokenTileTitle(-1)).toBe("0");
  });

  it("不含 M/B 单位、不含箭头、不含 NBSP", () => {
    const title = f07TokenTileTitle(141135111);
    expect(title).not.toMatch(/[MB↑↓→]/);
    expect(title).not.toContain("\u00a0");
  });
});

describe("renderEscapeRateSlot(上一轮成果,不得回退)", () => {
  it("仍是带 data-escape-rate-compact 的槽位", () => {
    const html = renderEscapeRateSlot();
    expect(html).toContain("data-escape-rate-compact");
    expect(html).toContain("…");
  });
});

describe("客户端 escapeRateLoad 仍复用同一次请求(上一轮成果,不得回退)", () => {
  it("脚本里仍处理紧凑槽位", () => {
    expect(part06).toContain("data-escape-rate-compact");
  });

  it("仍只有一处 /api/escape-rate 请求", () => {
    expect(part06.split("/api/escape-rate").length - 1).toBe(1);
  });
});