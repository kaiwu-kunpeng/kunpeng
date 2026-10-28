import { describe, expect, test } from "vitest";
import { newSwitchMessages } from "../../src/cli.js";
import { cliSource } from "../helpers/cli-source.js";

describe("newSwitchMessages", () => {
  test("returns unseen messages in original order", () => {
    const all = [{ id: "a" }, { id: "b" }, { id: "c" }];

    expect(newSwitchMessages(all, new Set(["a"]))).toEqual([{ id: "b" }, { id: "c" }]);
  });

  test("returns an empty array when every id has been seen", () => {
    const all = [{ id: "a" }, { id: "b" }];

    expect(newSwitchMessages(all, new Set(["a", "b"]))).toEqual([]);
  });

  test("returns an empty array for an empty inbox", () => {
    expect(newSwitchMessages([], new Set(["a"]))).toEqual([]);
  });

  test("does not mutate inputs and returns a new array", () => {
    const all = [{ id: "a", body: "first" }, { id: "b", body: "second" }];
    const seen = new Set(["a"]);
    const beforeAll = structuredClone(all);
    const beforeSeen = new Set(seen);

    const fresh = newSwitchMessages(all, seen);

    expect(fresh).toEqual([{ id: "b", body: "second" }]);
    expect(fresh).not.toBe(all);
    expect(all).toEqual(beforeAll);
    expect(seen).toEqual(beforeSeen);
  });
});

describe("inbox watch CLI wiring", () => {
  test("source handles --watch and calls newSwitchMessages in the watch loop", () => {
    const cli = cliSource();

    expect(cli).toContain('rest.includes("--watch")');
    expect(cli).toContain("const seen = new Set<string>()");
    expect(cli).toContain("const fresh = newSwitchMessages(msgs, seen)");
  });
});
