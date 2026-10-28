import { describe, it, expect } from "vitest";
import { httpSource } from "../helpers/http-source.js";
import { stateSource } from "../helpers/state-source.js";

describe("productActivity 接进 state/http", () => {
  it("state.ts 声明 productActivity 字段", () => {
    const src = stateSource();
    expect(src).toMatch(/productActivity\?:\s*ProductActivityEvent\[\]/);
    expect(src).toMatch(/ProductActivityEvent.*from "\.\.\/product\/activity-log\.js"/s);
  });
  it("http.ts withSelectedProduct 读 readActivity 填 productActivity", () => {
    const src = httpSource();
    expect(src).toMatch(/readActivity\(/);
    expect(src).toMatch(/productActivity/);
    expect(src).toMatch(/readActivity.*from "\.\.\/product\/activity-log\.js"/s);
  });
});
