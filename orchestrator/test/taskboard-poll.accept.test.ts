import { clientSource } from "./helpers/client-source.js";
import { describe, expect, it } from "vitest";

const src = clientSource();

describe("协作队列轮询(作者验收)", () => {
  it("有轮询 timer 且会清理", () => {
    expect(src).toContain("taskBoardPollTimer");
    expect(src).toContain("setInterval");
    // 清理:clearInterval 出现且与 taskBoard timer 关联
    expect(src.includes("clearInterval(taskBoardPollTimer)") || /taskBoardPollTimer[^;]*clearInterval|clearInterval[^;]*taskBoardPollTimer/.test(src)).toBe(true);
  });
  it("轮询调 loadTaskBoard", () => {
    expect(src).toContain("loadTaskBoard");
  });
});
