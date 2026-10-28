import { describe, it, expect } from "vitest";
import { parseRegisterAgentArgs } from "../../src/cli-commands/switchboard.js";

describe("parseRegisterAgentArgs", () => {
  it("两个参数都给", () => {
    expect(parseRegisterAgentArgs(["--pid", "4321", "--task", "写码"])).toEqual({
      pid: 4321,
      task: "写码",
    });
  });

  it("顺序任意", () => {
    expect(parseRegisterAgentArgs(["--task", "调研", "--pid", "77"])).toEqual({
      pid: 77,
      task: "调研",
    });
  });

  it("只给 pid", () => {
    expect(parseRegisterAgentArgs(["--pid", "9"])).toEqual({ pid: 9 });
  });

  it("只给 task", () => {
    expect(parseRegisterAgentArgs(["--task", "看看"])).toEqual({ task: "看看" });
  });

  it("都不给时返回空对象", () => {
    expect(parseRegisterAgentArgs([])).toEqual({});
    expect(parseRegisterAgentArgs(["其它", "参数"])).toEqual({});
  });

  it("pid 非数字一律当作未提供", () => {
    expect(parseRegisterAgentArgs(["--pid", "abc"])).toEqual({});
    expect(parseRegisterAgentArgs(["--pid", "1.5"]).pid).toBeUndefined();
  });

  it("pid 为零或负数当作未提供", () => {
    expect(parseRegisterAgentArgs(["--pid", "0"])).toEqual({});
    expect(parseRegisterAgentArgs(["--pid", "-3"])).toEqual({});
  });

  it("pid 缺值当作未提供", () => {
    expect(parseRegisterAgentArgs(["--pid"])).toEqual({});
  });

  it("task 缺值或空串当作未提供", () => {
    expect(parseRegisterAgentArgs(["--task"])).toEqual({});
    expect(parseRegisterAgentArgs(["--task", ""])).toEqual({});
  });

  it("不修改入参数组", () => {
    const argv = ["--pid", "5", "--task", "x"];
    const before = [...argv];
    parseRegisterAgentArgs(argv);
    expect(argv).toEqual(before);
  });
});