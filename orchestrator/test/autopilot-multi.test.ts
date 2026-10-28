import { expect, test } from "vitest";
import { runMultiRepoAutopilot } from "../src/loop/autopilot.js";

test("runMultiRepoAutopilot scans repos sequentially and keeps going after repo errors", async () => {
  const repos = [
    { repoPath: "/a", id: "a", name: "A" },
    { repoPath: "/b", id: "b", name: "B" },
    { repoPath: "/c", id: "c", name: "C" },
  ];
  const calls: string[] = [];

  const r = await runMultiRepoAutopilot({
    repos,
    runOne: async (repo) => {
      calls.push(repo.repoPath);
      if (repo.repoPath === "/a") return { rejected: [], merged: ["f1", "f2"], skipped: [] };
      if (repo.repoPath === "/b") throw new Error("仓不可达");
      return { rejected: [], merged: [], skipped: [{ flowId: "f3", reason: "审查闸拦" }] };
    },
  });

  expect(r.totalMerged).toBe(2);
  expect(r.totalSkipped).toBe(1);
  expect(r.outcomes).toHaveLength(3);

  const a = r.outcomes.find((outcome) => outcome.repoPath === "/a");
  expect(a?.result?.merged).toHaveLength(2);

  const b = r.outcomes.find((outcome) => outcome.repoPath === "/b");
  expect(b?.error).toContain("仓不可达");
  expect(b?.result).toBeUndefined();

  expect(r.outcomes[2]?.repoPath).toBe("/c");
  expect(r.outcomes[2]?.result).toBeDefined();
  expect(calls).toEqual(["/a", "/b", "/c"]);
});
