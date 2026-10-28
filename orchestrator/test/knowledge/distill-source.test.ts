import { expect, test } from "vitest";
import { selectDistillSource } from "../../src/knowledge/distill-source.js";

test("L1 深读读全文 raw 而非一句话 summary", () => {
  const card = { raw: "全文很长很长的正文……", summary: "一句话摘要", distill: "" };
  expect(selectDistillSource(card, 1)).toBe("全文很长很长的正文……");
});

test("L1 无 raw 时退回 summary", () => {
  expect(selectDistillSource({ summary: "一句话摘要" }, 1)).toBe("一句话摘要");
});

test("L2 接上一层 distill 精炼", () => {
  const card = { raw: "全文", summary: "摘要", distill: "- 要点A\n- 要点B" };
  expect(selectDistillSource(card, 2)).toBe("- 要点A\n- 要点B");
});

test("L2 无 distill 时退回 summary", () => {
  expect(selectDistillSource({ raw: "全文", summary: "摘要" }, 2)).toBe("摘要");
});

test("全空时返回空串", () => {
  expect(selectDistillSource({}, 1)).toBe("");
});