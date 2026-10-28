import { expect, test } from "vitest";
import { CodeGraphStore } from "../../src/codegraph/store.js";
import { skeleton } from "../../src/codegraph/skeleton.js";

test("renders one signature line per node, sorted by file:line", () => {
  const s = new CodeGraphStore();
  s.addNode({ id: "b", kind: "function", name: "validate", file: "auth.ts", line: 20 });
  s.addNode({ id: "a", kind: "class", name: "UserService", file: "auth.ts", line: 5 });
  const out = skeleton(s).split("\n");
  expect(out[0]).toBe("class UserService @ auth.ts:5");
  expect(out[1]).toBe("function validate @ auth.ts:20");
});
test("empty store yields empty string", () => {
  expect(skeleton(new CodeGraphStore())).toBe("");
});