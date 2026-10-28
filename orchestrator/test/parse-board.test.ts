import { expect, test } from "vitest";
import { parseBoard } from "../src/board/parse-board.js";

const good = JSON.stringify({
  schema: "kunpeng-board/v1",
  generatedAt: 1781400000000,
  project: { id: "demo", name: "Demo 项目", repoPath: "/x/demo" },
  systemLight: "green",
  activeFlows: [], plans: [], humanGates: [], blockers: [], passedLines: 100,
});

test("parses a valid kunpeng-board/v1 board.json", () => {
  const b = parseBoard(good);
  expect(b).not.toBeNull();
  expect(b!.project.id).toBe("demo");
  expect(b!.project.name).toBe("Demo 项目");
  expect(b!.systemLight).toBe("green");
});

test("defensive: bad JSON / wrong schema / missing project → null, never throws", () => {
  expect(parseBoard("not json")).toBeNull();
  expect(parseBoard(JSON.stringify({ schema: "other/v1", project: { id: "x", name: "y" } }))).toBeNull();
  expect(parseBoard(JSON.stringify({ schema: "kunpeng-board/v1", project: { id: 1 } }))).toBeNull();
  expect(parseBoard(JSON.stringify({ schema: "kunpeng-board/v1", project: { id: "x", name: "y" } }))).toBeNull();
  expect(parseBoard(JSON.stringify({ schema: "kunpeng-board/v1" }))).toBeNull();
});
