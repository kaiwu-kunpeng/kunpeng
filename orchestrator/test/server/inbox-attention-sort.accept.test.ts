import { describe, expect, it } from "vitest";
import { sortReviewItemsByAttention } from "../../src/server/ui/views/review-inbox.js";
import type { ReviewItem } from "../../src/server/state.js";

function item(id: string, verdict?: "approve" | "reject" | "review"): ReviewItem {
  return {
    projectId: "p", projectName: "P", kind: "merge", id, title: id, detail: "",
    ...(verdict ? { preReview: { verdict, reason: "r", at: 1 } } : {}),
  } as ReviewItem;
}

describe("收件箱注意力排序(作者验收)", () => {
  it("reject → review → 无预审 → approve", () => {
    const sorted = sortReviewItemsByAttention([
      item("a-approve", "approve"),
      item("b-none"),
      item("c-reject", "reject"),
      item("d-review", "review"),
    ]);
    expect(sorted.map((i) => i.id)).toEqual(["c-reject", "d-review", "b-none", "a-approve"]);
  });

  it("同优先级保持原序(稳定)", () => {
    const sorted = sortReviewItemsByAttention([
      item("r1", "review"), item("r2", "review"), item("k1", "reject"),
    ]);
    expect(sorted.map((i) => i.id)).toEqual(["k1", "r1", "r2"]);
  });

  it("空数组/不修改入参", () => {
    expect(sortReviewItemsByAttention([])).toEqual([]);
    const input = [item("x", "approve"), item("y", "reject")];
    const before = input.map((i) => i.id);
    sortReviewItemsByAttention(input);
    expect(input.map((i) => i.id)).toEqual(before);
  });
});