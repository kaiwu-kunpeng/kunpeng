import { expect, test } from "vitest";
import { pickResurfacing } from "../../src/knowledge/resurface.js";
import type { Capture } from "../../src/knowledge/capture-store.js";

function capture(id: string, createdAt: number, promoted: boolean): Capture {
  return {
    id,
    source: "text",
    kind: "note",
    raw: `raw ${id}`,
    summary: `summary ${id}`,
    tags: [id],
    createdAt,
    promoted,
  };
}

function ids(captures: Capture[]): string[] {
  return captures.map((item) => item.id);
}

const captures: Capture[] = [
  capture("promoted-old", 1, true),
  capture("fresh-unpromoted", 5, false),
  capture("old-unpromoted", 2, false),
  capture("mid-promoted", 3, true),
  capture("mid-unpromoted", 4, false),
];

test("ranks unpromoted captures before promoted ones and older captures first within groups", () => {
  const picked = pickResurfacing(captures, 0, 3);

  expect(picked).toHaveLength(3);
  expect(ids(picked)).toEqual(["old-unpromoted", "mid-unpromoted", "fresh-unpromoted"]);
});

test("rotates the start point by day key", () => {
  const dayZero = pickResurfacing(captures, 0, 2);
  const dayOne = pickResurfacing(captures, 1, 2);

  expect(dayZero[0].id).not.toBe(dayOne[0].id);
  expect(ids(dayZero)).toEqual(["old-unpromoted", "mid-unpromoted"]);
  expect(ids(dayOne)).toEqual(["mid-unpromoted", "fresh-unpromoted"]);
});

test("returns an empty list for empty input", () => {
  expect(pickResurfacing([], 0, 5)).toEqual([]);
});

test("returns every capture once when limit exceeds capture count", () => {
  const picked = pickResurfacing(captures, 0, 99);
  const pickedIds = ids(picked);

  expect(picked).toHaveLength(captures.length);
  expect(new Set(pickedIds).size).toBe(captures.length);
});

test("normalizes negative day keys and wraps deterministically", () => {
  expect(ids(pickResurfacing(captures, -1, 2))).toEqual(["mid-promoted", "old-unpromoted"]);
});

test("does not filter promoted captures when all captures are promoted", () => {
  const allPromoted = [
    capture("p3", 3, true),
    capture("p1", 1, true),
    capture("p2", 2, true),
  ];

  expect(ids(pickResurfacing(allPromoted, 0, 2))).toEqual(["p1", "p2"]);
});

test("does not mutate the input array order", () => {
  const before = ids(captures);

  pickResurfacing(captures, 0, 3);

  expect(ids(captures)).toEqual(before);
});
