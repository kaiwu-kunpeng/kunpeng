import { describe, expect, it } from "vitest";
import { liftAcceptance } from "../src/product/gherkin.js";

const REAL_CASE = "当且仅当存在至少一条'不一致'时,工具以非零退出码结束;全部一致或仅有'无法复量'时退出码为0且在输出中显式列出无法复量清单";

describe("验收标准不许丢掉断言", () => {
  it("以「当」开头的中文散文:then 非空且保全原文,标题不是（未命名）", () => {
    const [scenario] = liftAcceptance([REAL_CASE]);
    expect(scenario).toBeDefined();
    expect(scenario.then.length).toBeGreaterThan(0);
    expect(scenario.then.join("")).toContain("工具以非零退出码结束");
    expect(scenario.title).not.toBe("（未命名）");
  });

  it("一整批真实验收原文:没有任何一条的 then 为空", () => {
    const batch = [
      "输入一份含状态断言的交接文档,工具能识别三类断言:灯/状态、计数、已修复声明",
      "对每条断言输出三态判定之一:一致(绿)、不一致(红)、无法复量(黄,标注原因)",
      REAL_CASE,
      "对同一份文档重复运行两次,在真值源不变时判定结果稳定一致",
      "那么系统必须给出明确原因",
    ];
    const scenarios = liftAcceptance(batch);
    expect(scenarios).toHaveLength(batch.length);
    for (const [index, scenario] of scenarios.entries()) {
      expect(scenario.then.length, `第 ${index} 条的 then 为空`).toBeGreaterThan(0);
    }
  });

  it("真 Gherkin(中文关键字后无空格)解析行为不变", () => {
    const [scenario] = liftAcceptance(["当点击导出时\n那么下载CSV"]);
    expect(scenario.then).toEqual(["下载CSV"]);
  });

  it("真 Gherkin(英文)解析行为不变", () => {
    const [scenario] = liftAcceptance(["When user clicks export\nThen a CSV downloads"]);
    expect(scenario.then.join("")).toContain("CSV");
  });

  it("长标题以 … 结尾,短标题不带 …", () => {
    const long = "对每条断言输出三态判定之一:一致(绿)、不一致(红,且给出文档值 vs 实测值)、无法复量(黄,标注原因),任何断言都不得在无适配器时被静默判为一致";
    const [longScenario] = liftAcceptance([long]);
    expect(longScenario.title.endsWith("…")).toBe(true);
    expect(longScenario.title.length).toBeLessThanOrEqual(61);

    const [shortScenario] = liftAcceptance(["工具退出码为 0"]);
    expect(shortScenario.title).toBe("工具退出码为 0");
    expect(shortScenario.title.endsWith("…")).toBe(false);
  });
});