import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { composeSendbackSpec, appendComment, readComments } from "../src/server/gate-sendback.js";

describe("diff 评论回灌(作者验收)", () => {
  it("composeSendbackSpec 生成合法 spec(scope+accept+军规)", () => {
    const spec = composeSendbackSpec("plan-x1", [
      { planId: "plan-x1", file: "orchestrator/src/a.ts", text: "这里改成防抖", at: 1 },
      { planId: "plan-x1", file: "orchestrator/src/a.ts", text: "命名不清", at: 2 },
      { planId: "plan-x1", file: "orchestrator/src/b.ts", text: "缺空态", at: 3 },
    ]);
    expect(spec).toContain("```scope");
    expect((spec.match(/allow: orchestrator\/src\/a\.ts/g) || []).length).toBe(1);
    expect(spec).toContain("allow: orchestrator/src/b.ts");
    expect(spec).toContain("# 评审回改:plan-x1");
    expect(spec).toContain("这里改成防抖");
    expect(spec).toContain("```accept");
    expect(spec).toContain("test:unit");
    expect(spec.includes("不得回退") || spec.includes("禁止回退")).toBe(true);
  });
  it("评论 JSONL 往返", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kp-gc-"));
    await appendComment(dir, { planId: "p1", file: "f.ts", text: "评论一", at: 1 });
    await appendComment(dir, { planId: "p1", file: "g.ts", text: "评论二", at: 2 });
    await appendComment(dir, { planId: "p2", file: "h.ts", text: "别家的", at: 3 });
    const list = await readComments(dir, "p1");
    expect(list.length).toBe(2);
    expect(list[0]!.text).toBe("评论一");
    expect((await readComments(dir, "p9")).length).toBe(0);
  });
});