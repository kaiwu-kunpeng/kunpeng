import { describe, expect, test } from "vitest";
import { selectBestCandidate, type Candidate } from "../../src/loop/best-of-n.js";

describe("selectBestCandidate", () => {
  test("selects the fastest passing candidate and ranks failed candidates last", () => {
    const result = selectBestCandidate([
      { id: "a", passed: true, ms: 300 },
      { id: "b", passed: true, ms: 100 },
      { id: "c", passed: false, ms: 50 },
    ]);

    expect(result.winner?.id).toBe("b");
    expect(result.ranking.map((candidate) => candidate.id)).toEqual(["b", "a", "c"]);
    expect(result.reason).toContain("通过验收");
    expect(result.reason).toContain("最快");
  });

  test("returns no winner when every candidate fails acceptance", () => {
    const result = selectBestCandidate([
      { id: "a", passed: false, ms: 10 },
      { id: "b", passed: false, ms: 5 },
    ]);

    expect(result.winner).toBeNull();
    expect(result.reason).toContain("无一通过");
  });

  test("prefers higher score over lower latency for passing candidates", () => {
    const result = selectBestCandidate([
      { id: "fast", passed: true, ms: 10, score: 1 },
      { id: "better", passed: true, ms: 20, score: 2 },
    ]);

    expect(result.winner?.id).toBe("better");
    expect(result.ranking.map((candidate) => candidate.id)).toEqual(["better", "fast"]);
    expect(result.reason).toContain("最高分");
  });

  test("uses lower cost as a tie breaker after pass, score, and latency", () => {
    const result = selectBestCandidate([
      { id: "expensive", passed: true, ms: 100, cost: 10 },
      { id: "cheap", passed: true, ms: 100, cost: 1 },
    ]);

    expect(result.winner?.id).toBe("cheap");
    expect(result.ranking.map((candidate) => candidate.id)).toEqual(["cheap", "expensive"]);
    expect(result.reason).toContain("最省");
  });

  test("returns an empty result for empty input", () => {
    const result = selectBestCandidate([]);

    expect(result.winner).toBeNull();
    expect(result.ranking).toEqual([]);
    expect(result.reason).toBe("无候选");
  });

  test("does not modify the input array or candidate objects", () => {
    const candidates: Candidate[] = [
      { id: "a", passed: true, ms: 300, cost: 2, score: 1 },
      { id: "b", passed: true, ms: 100, cost: 1, score: 1 },
      { id: "c", passed: false, ms: 50 },
    ];
    const original = structuredClone(candidates);
    const objectIdentities = [...candidates];

    selectBestCandidate(candidates);

    expect(candidates).toEqual(original);
    expect(candidates).toEqual(objectIdentities);
  });

  test("keeps input order for otherwise identical candidates", () => {
    const result = selectBestCandidate([
      { id: "first", passed: true, ms: 100, cost: 1, score: 1 },
      { id: "second", passed: true, ms: 100, cost: 1, score: 1 },
    ]);

    expect(result.ranking.map((candidate) => candidate.id)).toEqual(["first", "second"]);
  });
});
