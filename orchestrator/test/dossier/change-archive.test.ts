import { describe, it, expect } from "vitest";
import {
  proposeChange,
  advanceChange,
  renderChangeArchive,
  type ChangeRecord,
} from "../../src/dossier/change-archive.js";

describe("change 归档血缘", () => {
  it("proposeChange 生成 proposed 记录", () => {
    const r = proposeChange({ id: "c1", summary: "加删除记忆能力", at: 100, adr: "0004", flowId: "f1" });
    expect(r.stage).toBe("proposed");
    expect(r.id).toBe("c1");
    expect(r.adr).toBe("0004");
  });

  it("advanceChange 合法前进 proposed→applied→archived", () => {
    const p = proposeChange({ id: "c1", summary: "x", at: 100 });
    const a = advanceChange(p, "applied", 200);
    expect(a.stage).toBe("applied");
    expect(a.at).toBe(200);
    expect(p.stage).toBe("proposed"); // 不可变,不改入参
    const z = advanceChange(a, "archived", 300);
    expect(z.stage).toBe("archived");
  });

  it("advanceChange 跳级 proposed→archived 抛错", () => {
    const p = proposeChange({ id: "c1", summary: "x", at: 100 });
    expect(() => advanceChange(p, "archived", 200)).toThrow();
  });

  it("advanceChange 回退 applied→proposed 抛错", () => {
    const a = advanceChange(proposeChange({ id: "c1", summary: "x", at: 100 }), "applied", 200);
    expect(() => advanceChange(a, "proposed", 300)).toThrow();
  });

  it("renderChangeArchive 渲染列表含 stage/id/ADR/flow", () => {
    const records: ChangeRecord[] = [
      proposeChange({ id: "c1", summary: "加删除", at: 100, adr: "0004", flowId: "f1" }),
    ];
    const md = renderChangeArchive(records);
    expect(md).toContain("## 变更归档");
    expect(md).toContain("[proposed] c1");
    expect(md).toContain("ADR:0004");
    expect(md).toContain("flow:f1");
  });

  it("renderChangeArchive 空列表给占位", () => {
    const md = renderChangeArchive([]);
    expect(md).toContain("## 变更归档");
    expect(md).toContain("(暂无变更)");
  });
});