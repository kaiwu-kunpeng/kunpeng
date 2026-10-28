import { expect, test } from "vitest";
import { AccountPool } from "../src/agent/account-pool.js";

test("size returns the number of accounts", () => {
  expect(new AccountPool([{ id: "a" }, { id: "b" }]).size).toBe(2);
});

test("next round-robins through accounts and wraps around", () => {
  const pool = new AccountPool([{ id: "a" }, { id: "b" }]);
  expect([pool.next().id, pool.next().id, pool.next().id]).toEqual(["a", "b", "a"]);
});

test("next throws on an empty pool", () => {
  expect(() => new AccountPool([]).next()).toThrow("account pool is empty");
});
