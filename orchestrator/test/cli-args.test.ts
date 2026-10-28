import { describe, it, expect } from "vitest";
import { positionalArgs } from "../src/util/cli-args.js";

describe("positionalArgs", () => {
  it("剔除带值旗标的值(治 adr 标题泄漏)", () => {
    const rest = ["采用档案层", "--status", "Accepted", "--supersedes", "0001"];
    expect(positionalArgs(rest, ["--status", "--supersedes"])).toEqual(["采用档案层"]);
  });
  it("多个位置参数保留顺序", () => {
    const rest = ["add", "我的条目", "--type", "feat"];
    expect(positionalArgs(rest, ["--type"])).toEqual(["add", "我的条目"]);
  });
  it("布尔旗标(不在 valueFlags)只剔除自身,不吃掉下一个位置参数", () => {
    const rest = ["标题", "--adaptive", "后续词"];
    expect(positionalArgs(rest, ["--status"])).toEqual(["标题", "后续词"]);
  });
  it("无旗标时原样返回", () => {
    expect(positionalArgs(["a", "b", "c"], [])).toEqual(["a", "b", "c"]);
  });
  it("旗标在末尾无值不越界", () => {
    expect(positionalArgs(["t", "--status"], ["--status"])).toEqual(["t"]);
  });
});
