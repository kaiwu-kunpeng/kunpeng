import { expect, test } from "vitest";
import {
  findingToCapture,
  findingKey,
  dedupeFindings,
  selectTopPerChannel,
  type SelfEvoFinding,
} from "../src/evolution/self-evo-finding.js";

function f(over: Partial<SelfEvoFinding>): SelfEvoFinding {
  return { channel: "ears", title: "t", detail: "d", sources: [], evidenceState: "untested", score: 0, ...over };
}

test("findingToCapture 映射进知识库输入：source=text/kind/category=self-evolution，tags 含 channel 与 evidenceState", () => {
  const cap = findingToCapture(f({ channel: "security", title: "T1", detail: "D1", evidenceState: "downgraded" }));
  expect(cap.source).toBe("text");
  expect(cap.kind).toBe("self-evolution");
  expect(cap.category).toBe("self-evolution");
  expect(cap.raw).toBe("D1");
  expect(cap.title).toBe("T1");
  expect(cap.tags).toContain("security");
  expect(cap.tags).toContain("downgraded");
});

test("findingKey 大小写/空白无关，channel 不同则 key 不同", () => {
  expect(findingKey(f({ channel: "ears", title: "Hello  World" }))).toBe(
    findingKey(f({ channel: "ears", title: "  hello world " })),
  );
  expect(findingKey(f({ channel: "ears", title: "X" }))).not.toBe(findingKey(f({ channel: "module", title: "X" })));
});

test("dedupeFindings 去列表内重复(保首次保序)并尊重+回写 seen", () => {
  const seen = new Set<string>();
  const out = dedupeFindings([f({ title: "A" }), f({ title: "a" }), f({ title: "B" })], seen);
  expect(out.map((x) => x.title)).toEqual(["A", "B"]);
  const out2 = dedupeFindings([f({ title: "A" }), f({ title: "C" })], seen);
  expect(out2.map((x) => x.title)).toEqual(["C"]);
});

test("selectTopPerChannel 每通道按 score 降序取前 N，通道间独立", () => {
  const list = [
    f({ channel: "ears", title: "e1", score: 1 }),
    f({ channel: "ears", title: "e2", score: 5 }),
    f({ channel: "ears", title: "e3", score: 3 }),
    f({ channel: "ears", title: "e4", score: 2 }),
    f({ channel: "module", title: "m1", score: 9 }),
  ];
  const top = selectTopPerChannel(list, 2);
  expect(top.filter((x) => x.channel === "ears").map((x) => x.title)).toEqual(["e2", "e3"]);
  expect(top.filter((x) => x.channel === "module").map((x) => x.title)).toEqual(["m1"]);
});