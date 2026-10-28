import { describe, it, expect } from "vitest";
import { part03 } from "../../src/server/ui/client-parts/part03.js";

describe("写大文件进度帧的前端消费", () => {
  it("part03 里有 kp-tool-arg 分支并读 data-chars", () => {
    expect(part03).toContain("kp-tool-arg");
    expect(part03).toContain("data-chars");
  });

  it("该分支更新工具卡状态行 kp-tool-st", () => {
    const idx = part03.indexOf("kp-tool-arg");
    expect(idx).toBeGreaterThan(-1);
    const branch = part03.slice(idx, idx + 900);
    expect(branch).toContain("kp-tool-st");
  });

  it("该分支提前 return，不落到 insertAdjacentHTML 追加路径", () => {
    const argIdx = part03.indexOf("kp-tool-arg");
    const appendIdx = part03.indexOf('insertAdjacentHTML("beforeend", data)');
    expect(argIdx).toBeGreaterThan(-1);
    expect(appendIdx).toBeGreaterThan(argIdx);
    const between = part03.slice(argIdx, appendIdx);
    expect(between).toContain("return");
  });

  it("有万字符与字符两种单位文案", () => {
    expect(part03).toContain("万字符");
    expect(part03).toContain("执行中… 已生成");
  });

  it("既有 kp-tool-upd 分支未被破坏", () => {
    expect(part03).toContain("kp-tool-upd");
    expect(part03).toContain("data-tool-id");
  });
});