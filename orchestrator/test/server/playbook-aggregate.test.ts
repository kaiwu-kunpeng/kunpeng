import { describe, it, expect } from "vitest";
import { aggregatePlaybooks } from "../../src/server/state.js";
import { httpSource } from "../helpers/http-source.js";

describe("Playbook 跨项目聚合", () => {
  it("平铺合并并补 projectId", () => {
    const snaps = [
      { id: "acme-shop", name: "Acme", state: { playbooks: [{ id: "acme-catalog", title: "扩品类", sections: {}, body: "" }] } },
      { id: "kunpeng", name: "鲲鹏", state: {} },
    ] as never;
    const out = aggregatePlaybooks(snaps);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("acme-catalog");
    expect((out[0] as { projectId?: string }).projectId).toBe("acme-shop");
  });

  it("http 聚合装配处接线（与 loops 同点）", () => {
    const src = httpSource();
    const idx = src.indexOf("aggregateLoops(snaps)");
    expect(idx).toBeGreaterThan(-1);
    expect(src.slice(idx - 1500, idx + 1500)).toContain("aggregatePlaybooks(snaps)");
  });
});
