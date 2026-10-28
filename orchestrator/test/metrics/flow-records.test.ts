import { describe, it, expect } from "vitest";
import {
  parseMergedRecordsFromGitLog,
  parseRevertedFlowIds,
  mergeRevertSignals,
} from "../../src/metrics/flow-records.js";
import { computeEscapeRate } from "../../src/metrics/escape-rate.js";

describe("parseMergedRecordsFromGitLog", () => {
  it("从 kp merge 提交抽 flowId + mergedAt(ms)，忽略非 kp 合并", () => {
    const log = [
      "1782520687|Merge branch 'kp/wire-span' into HEAD",
      "1782520042|Merge branch 'kp/flow-b-es-0-0' into HEAD",
      "1782519000|Merge pull request #12 from foo/bar",
      "1782518000|Merge branch 'feature/x' into HEAD",
    ].join("\n");
    const recs = parseMergedRecordsFromGitLog(log);
    expect(recs).toHaveLength(2);
    expect(recs[0]).toMatchObject({
      flowId: "wire-span",
      merged: true,
      reverted: false,
      mergedAt: 1782520687000,
    });
    expect(recs.map((r) => r.flowId)).toEqual(["wire-span", "flow-b-es-0-0"]);
  });

  it("空文本或无 kp 合并 → 空数组", () => {
    expect(parseMergedRecordsFromGitLog("")).toEqual([]);
    expect(
      parseMergedRecordsFromGitLog("1|Merge branch 'feature/x' into HEAD"),
    ).toEqual([]);
  });
});

describe("parseRevertedFlowIds", () => {
  it("从 Revert 提交头抽被还原的 kp flowId（两种格式）", () => {
    const log = [
      'Revert "kp(flow-b-es-0-0): verified"',
      "Merge branch 'kp/other' into HEAD",
      "Revert \"Merge branch 'kp/wire-span' into HEAD\"",
    ].join("\n");
    expect(parseRevertedFlowIds(log).sort()).toEqual([
      "flow-b-es-0-0",
      "wire-span",
    ]);
  });

  it("无 revert → 空数组", () => {
    expect(parseRevertedFlowIds("Merge branch 'kp/a' into HEAD")).toEqual([]);
  });
});

describe("mergeRevertSignals", () => {
  it("git revert 与 rolled-back 两路并集都标 reverted，且不可变", () => {
    const merged = [
      { flowId: "a", merged: true, reverted: false, mergedAt: 1000 },
      { flowId: "b", merged: true, reverted: false, mergedAt: 2000 },
      { flowId: "c", merged: true, reverted: false, mergedAt: 3000 },
    ];
    const out = mergeRevertSignals(merged, ["a"], ["c"]);
    expect(out.find((r) => r.flowId === "a")!.reverted).toBe(true);
    expect(out.find((r) => r.flowId === "b")!.reverted).toBe(false);
    expect(out.find((r) => r.flowId === "c")!.reverted).toBe(true);
    // 入参未被修改
    expect(merged[0].reverted).toBe(false);
  });

  it("产出可直接喂 computeEscapeRate 得真逃逸率", () => {
    const merged = [
      { flowId: "a", merged: true, reverted: false, mergedAt: 1000 },
      { flowId: "b", merged: true, reverted: false, mergedAt: 2000 },
    ];
    const out = mergeRevertSignals(merged, ["a"], []);
    const er = computeEscapeRate(out);
    expect(er.mergedCount).toBe(2);
    expect(er.escapedCount).toBe(1);
    expect(er.rate).toBe(0.5);
    expect(er.escapedFlowIds).toEqual(["a"]);
  });
});