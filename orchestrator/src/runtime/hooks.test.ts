import { describe, expect, test } from "vitest";
import { parseHooksConfig, evaluatePreMerge } from "./hooks.js";

describe("parseHooksConfig", () => {
  test("valid preMerge array", () => {
    expect(parseHooksConfig('{"preMerge":["npm test","npm run lint"]}')).toEqual({ preMerge: ["npm test", "npm run lint"] });
  });
  test("filters non-string items", () => {
    expect(parseHooksConfig('{"preMerge":["ok",1,null,"two"]}')).toEqual({ preMerge: ["ok", "two"] });
  });
  test("missing / non-array / invalid json → empty", () => {
    expect(parseHooksConfig("{}")).toEqual({});
    expect(parseHooksConfig("not json")).toEqual({});
    expect(parseHooksConfig('{"preMerge":"nope"}')).toEqual({});
  });
});
describe("evaluatePreMerge", () => {
  test("all pass → ok", async () => {
    expect(await evaluatePreMerge(["a","b"], "/r", async () => ({ code: 0, output: "" }))).toEqual({ ok: true, failures: [] });
  });
  test("collects failures", async () => {
    const out = await evaluatePreMerge(["good","bad"], "/r", async (c) => c==="bad"?{code:1,output:"boom"}:{code:0,output:""});
    expect(out.ok).toBe(false);
    expect(out.failures).toEqual([{ command: "bad", output: "boom" }]);
  });
  test("empty → ok", async () => {
    expect(await evaluatePreMerge([], "/r", async () => ({ code: 0, output: "" }))).toEqual({ ok: true, failures: [] });
  });
});
