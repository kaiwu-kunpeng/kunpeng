import { expect, test } from "vitest";
import { buildTagCloud, tagLevel } from "../../src/knowledge/tagcloud.js";
import type { Capture } from "../../src/knowledge/capture-store.js";

function capture(id: string, tags: string[], category?: string): Capture {
  return {
    id,
    source: "text",
    kind: "note",
    raw: `raw ${id}`,
    tags,
    category,
    createdAt: 1,
    promoted: false,
  };
}

function displayTags(captures: Capture[]): string[] {
  return buildTagCloud(captures).tags.map((item) => item.tag);
}

test("aggregates repeated tags and limits default output to top 40", () => {
  const many = Array.from({ length: 45 }, (_, index) =>
    capture(`c${index}`, [`长词${String(index).padStart(2, "0")}`]),
  );
  const result = buildTagCloud([
    capture("a", ["增长", "产品", " 增长 "]),
    capture("b", ["增长", "技术"]),
    ...many,
  ]);

  expect(result.tags).toHaveLength(40);
  expect(result.tags.find((item) => item.tag === "增长")?.count).toBe(3);
  expect(result.tags.find((item) => item.tag === "产品")?.count).toBe(1);
});

test("sorts displayed tags by zh locale compare", () => {
  const input = ["战略规划", "产品设计", "技术架构", "行业洞察"];
  const result = buildTagCloud(input.map((tag, index) => capture(`c${index}`, [tag])));
  const expected = [...input].sort((a, b) => a.localeCompare(b, "zh"));

  expect(result.tags.map((item) => item.tag)).toEqual(expected);
});

test("uses the category with the most votes for each tag", () => {
  const result = buildTagCloud([
    capture("p1", ["增长策略"], "产品"),
    capture("p2", ["增长策略"], "产品"),
    capture("p3", ["增长策略"], "产品"),
    capture("t1", ["增长策略"], "技术"),
  ]);

  expect(result.tags.find((item) => item.tag === "增长策略")?.category).toBe("产品");
});

test("filters tags shorter than two characters", () => {
  expect(displayTags([
    capture("a", ["A", "中", "  ", "有效标签"]),
  ])).toEqual(["有效标签"]);
});

test("calculates logarithmic tag levels", () => {
  expect(tagLevel(100, 1, 100)).toBe(5);
  expect(tagLevel(1, 1, 100)).toBe(1);
  expect(tagLevel(10, 1, 100)).toBeGreaterThanOrEqual(1);
  expect(tagLevel(10, 1, 100)).toBeLessThanOrEqual(5);
  expect(tagLevel(3, 3, 3)).toBe(3);
});

test("returns an empty tag cloud for empty input", () => {
  expect(buildTagCloud([])).toEqual({ tags: [], fMin: 0, fMax: 0 });
});
