import { expect, test } from "vitest";
import { renderBoardJson, renderBoardMarkdown } from "../src/board/board-render.js";
import type { BoardInput } from "../src/board/board-render.js";

const input: BoardInput = {
  project: { id: "kunpeng", name: "鲲鹏（本体）", repoPath: "/x/kunpeng" },
  systemLight: "green",
  activeFlows: [{ flowId: "f1", stage: "implement", requirement: "做个看板" }],
  plans: [{ id: "plan-abc", status: "verified", merged: true, desc: "BOARD 渲染" }],
  humanGates: [{ what: "合并主干", detail: "kp/plan-abc → main" }],
  blockers: [],
  passedLines: 6182,
};

test("renderBoardJson wraps input in stable schema + generatedAt", () => {
  const b = renderBoardJson(input, 1781400000000);
  expect(b.schema).toBe("kunpeng-board/v1");
  expect(b.generatedAt).toBe(1781400000000);
  expect(b.project.id).toBe("kunpeng");
  expect(b.passedLines).toBe(6182);
});

test("renderBoardMarkdown is tool-agnostic readable: title/schema/sections", () => {
  const md = renderBoardMarkdown(renderBoardJson(input, 1781400000000));
  expect(md).toContain("# 项目看板 · 鲲鹏（本体） (kunpeng)");
  expect(md).toContain("kunpeng-board/v1");
  expect(md).toContain("做个看板");        // 活跃流
  expect(md).toContain("BOARD 渲染");       // 方案
  expect(md).toContain("合并主干");         // 需人工
  expect(md).toContain("6182");             // 代码行
  expect(md).toContain("（无）");           // 空节(卡点)
});
