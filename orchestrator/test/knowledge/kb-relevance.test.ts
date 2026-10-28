import { describe, it, expect } from "vitest";
import { extractQueryTerms, scoreEntry, selectRelevant } from "../../src/knowledge/kb-relevance.js";

describe("extractQueryTerms", () => {
  it("抽代码味标识符(大写/下划线)+长普通词,小写去重", () => {
    const t = extractQueryTerms("Fix PtySessionPool and max_sessions, add a button now");
    expect(t).toContain("ptysessionpool");
    expect(t).toContain("max_sessions");
    expect(t).toContain("button"); // 普通词≥4
    expect(t).not.toContain("add"); // <4 且无大写/下划线
    expect(t).not.toContain("and");
  });
  it("去重保序：代码味在前、普通词在后", () => {
    expect(extractQueryTerms("Foo barbar Foo barbar")).toEqual(["foo", "barbar"]);
  });
});

describe("scoreEntry", () => {
  const entry = { tags: ["pty", "pool"], summary: "给 PtySessionPool 加上限" };
  it("tag 命中 +2，summary 命中 +1", () => {
    expect(scoreEntry({ tags: ["ptysessionpool"], summary: "x" }, ["ptysessionpool"])).toBe(2);
    expect(scoreEntry(entry, ["ptysessionpool"])).toBe(1); // 只 summary 含
    expect(scoreEntry(entry, ["pty"])).toBe(2); // tag 含
    expect(scoreEntry(entry, ["nope"])).toBe(0);
  });
});

describe("selectRelevant", () => {
  const entries = [
    { tags: ["a"], summary: "alpha", id: 1 },
    { tags: ["pty"], summary: "PtySessionPool", id: 2 },
    { tags: ["b"], summary: "beta", id: 3 },
  ];
  it("按相关性闸+top-k选,分高在前", () => {
    const r = selectRelevant(entries, ["pty"], { k: 2, minScore: 1 });
    expect(r[0].id).toBe(2); // 命中 tag score2
    expect(r.length).toBe(1); // 其余 score0 被 minScore 滤掉
  });
  it("minScore=0 + k 限制数量", () => {
    const r = selectRelevant(entries, ["zzz"], { k: 2, minScore: 0 });
    expect(r.length).toBe(2); // 全 score0 但 minScore0 保留,k 截 2,保持原顺序
    expect(r[0].id).toBe(1);
    expect(r[1].id).toBe(2);
  });
});
