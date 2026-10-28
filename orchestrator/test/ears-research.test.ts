import { expect, test } from "vitest";
import { earsFindings } from "../src/evolution/ears-research.js";
import type { LearningDigest } from "../src/evolution/failure-digest.js";
import type { Researcher } from "../src/research/types.js";

function digest(directions: string[]): LearningDigest {
  return { totalFailures: directions.length, patterns: [], directions };
}

const fakeOk: Researcher = {
  research: async (topic) => [
    { topic, source: "github.com/x/y", summary: `解法 for ${topic}`, suggestedUpgrade: `升级:${topic}` },
  ],
};

test("每个方向联网→ears 通道 finding，title 取 suggestedUpgrade，sources 含 source", async () => {
  const out = await earsFindings(digest(["d1", "d2"]), fakeOk);
  expect(out.length).toBe(2);
  expect(out.every((f) => f.channel === "ears")).toBe(true);
  expect(out.every((f) => f.evidenceState === "untested")).toBe(true);
  expect(out[0].title).toBe("升级:d1");
  expect(out[0].sources).toContain("github.com/x/y");
});

test("maxDirections 限制方向数", async () => {
  const out = await earsFindings(digest(["d1", "d2", "d3", "d4"]), fakeOk, { maxDirections: 2 });
  expect(out.length).toBe(2);
});

test("空 directions → 不调 researcher、返回 []", async () => {
  let called = 0;
  const spy: Researcher = { research: async () => { called++; return []; } };
  const out = await earsFindings(digest([]), spy);
  expect(out).toEqual([]);
  expect(called).toBe(0);
});

test("单方向 research 抛错 → 跳过该方向、不整体抛", async () => {
  const flaky: Researcher = {
    research: async (topic) => {
      if (topic === "bad") throw new Error("network down");
      return [{ topic, source: "s", summary: "ok" }];
    },
  };
  const out = await earsFindings(digest(["bad", "good"]), flaky);
  expect(out.length).toBe(1);
  expect(out[0].title).toBe("good");
});