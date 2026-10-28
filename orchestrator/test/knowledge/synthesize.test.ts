import { expect, test } from "vitest";
import type { Capture } from "../../src/knowledge/capture-store.js";
import { buildSynthesizeInput, selectByTopic, SYNTH_SYSTEM } from "../../src/knowledge/synthesize.js";

function capture(input: Partial<Capture> & Pick<Capture, "id" | "raw">): Capture {
  return {
    id: input.id,
    source: input.source ?? "text",
    kind: input.kind ?? "note",
    raw: input.raw,
    title: input.title,
    summary: input.summary,
    tags: input.tags ?? [],
    category: input.category,
    createdAt: input.createdAt ?? 1,
    promoted: input.promoted ?? false,
  };
}

test("selects captures by category, tag, or empty topic", () => {
  const captures = [
    capture({ id: "cap-product", raw: "p", category: "产品", tags: ["路线图"] }),
    capture({ id: "cap-strategy", raw: "s", category: "战略", tags: ["路线图", "护城河"] }),
    capture({ id: "cap-tech", raw: "t", category: "技术", tags: ["架构"] }),
  ];

  expect(selectByTopic(captures, { category: "战略" }).map((cap) => cap.id)).toEqual(["cap-strategy"]);
  expect(selectByTopic(captures, { tag: "路线图" }).map((cap) => cap.id)).toEqual(["cap-product", "cap-strategy"]);
  expect(selectByTopic(captures, {})).toEqual([]);
});

test("builds synthesize input with topic, ids, titles, summaries, and separators", () => {
  const input = buildSynthesizeInput("战略", [
    capture({ id: "cap-a", title: "战略标题", summary: "战略摘要", raw: "战略原文" }),
    capture({ id: "cap-b", summary: "增长摘要", raw: "增长原文" }),
  ]);

  expect(input).toContain("主题：战略");
  expect(input).toContain("[cap-a] 战略标题");
  expect(input).toContain("战略摘要");
  expect(input).toContain("[cap-b] 增长摘要");
  expect(input).toContain("---");
});

test("system prompt keeps citation and no-fabrication constraints", () => {
  expect(SYNTH_SYSTEM).toContain("[卡片id]");
  expect(SYNTH_SYSTEM).toContain("别编");
});
