import { describe, expect, test, vi } from "vitest";
import { runBestOfN } from "../../src/loop/best-of-n-runner.js";
import type { SharedSpec } from "../../src/loop/best-of-n-runner.js";
import type { Candidate } from "../../src/loop/best-of-n.js";

describe("runBestOfN", () => {
  test("runs three candidates and selects the fastest passing candidate", async () => {
    const result = await runBestOfN({
      n: 3,
      runCandidate: async (index) => {
        const candidates: Candidate[] = [
          { id: "cand-0", passed: true, ms: 300 },
          { id: "cand-1", passed: true, ms: 100 },
          { id: "cand-2", passed: false, ms: 50 },
        ];

        return candidates[index];
      },
    });

    expect(result.winner?.id).toBe("cand-1");
    expect(result.candidates).toHaveLength(3);
    expect(result.n).toBe(3);
  });

  test("converts thrown candidate errors into failed candidates", async () => {
    const result = await runBestOfN({
      n: 3,
      runCandidate: async (index) => {
        if (index === 1) {
          throw new Error("candidate failed");
        }

        return { id: `real-${index}`, passed: index === 0, ms: 100 + index };
      },
    });

    expect(result.candidates[1]).toEqual({ id: "cand-1", passed: false, ms: 0 });
    expect(result.winner?.id).toBe("real-0");
  });

  test("starts all candidates in parallel with consecutive indexes", async () => {
    const started: number[] = [];
    const resolvers: Array<(candidate: Candidate) => void> = [];
    const resultPromise = runBestOfN({
      n: 4,
      runCandidate: (index) => {
        started.push(index);

        return new Promise<Candidate>((resolve) => {
          resolvers[index] = resolve;
        });
      },
    });

    await Promise.resolve();

    try {
      expect(started).toEqual([0, 1, 2, 3]);
      expect(resolvers).toHaveLength(4);
    } finally {
      resolvers.forEach((resolve, index) => {
        resolve({ id: `cand-${index}`, passed: index === 2, ms: index + 1 });
      });
    }

    const result = await resultPromise;

    expect(result.candidates.map((candidate) => candidate.id)).toEqual(["cand-0", "cand-1", "cand-2", "cand-3"]);
    expect(result.winner?.id).toBe("cand-2");
  });

  test("returns an empty result for n zero without running candidates", async () => {
    const runCandidate = vi.fn(async () => ({ id: "unused", passed: true, ms: 1 }));

    const result = await runBestOfN({ n: 0, runCandidate });

    expect(result).toEqual({
      winner: null,
      ranking: [],
      reason: "n<=0 无候选",
      candidates: [],
      n: 0,
    });
    expect(runCandidate).not.toHaveBeenCalled();
  });

  test("runSpecOnce 只调用一次并把 sharedSpec 透传给每个候选", async () => {
    const runSpecOnce = vi.fn(async () => ({ text: "共享SPEC", meta: {} }));
    const receivedSpecs: Array<SharedSpec | undefined> = [];

    await runBestOfN({
      n: 3,
      runSpecOnce,
      runCandidate: async (index, sharedSpec) => {
        receivedSpecs.push(sharedSpec);

        return { id: `cand-${index}`, passed: true, ms: index + 1 };
      },
    });

    expect(runSpecOnce).toHaveBeenCalledTimes(1);
    expect(receivedSpecs).toEqual([
      { text: "共享SPEC", meta: {} },
      { text: "共享SPEC", meta: {} },
      { text: "共享SPEC", meta: {} },
    ]);
  });

  test("n 为 0 时不调用 runSpecOnce", async () => {
    const runSpecOnce = vi.fn(async () => ({ text: "unused" }));

    await runBestOfN({
      n: 0,
      runSpecOnce,
      runCandidate: async () => ({ id: "unused", passed: true, ms: 1 }),
    });

    expect(runSpecOnce).not.toHaveBeenCalled();
  });
});
