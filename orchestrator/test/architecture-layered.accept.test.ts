import { clientSource } from "./helpers/client-source.js";
import { describe, expect, it } from "vitest";
import { buildArchitectureGraph, ARCH_LAYER_LABELS } from "../src/server/ui/views/architecture-graph.js";

describe("架构层次化(作者验收)", () => {
  it("每个节点都有 0-4 的 layer,五层都有人", () => {
    const g = buildArchitectureGraph({} as never);
    expect(g.nodes.length).toBeGreaterThan(10);
    const layers = new Set<number>();
    for (const n of g.nodes) {
      const layer = (n as { layer?: number }).layer ?? (n as { data?: { layer?: number } }).data?.layer;
      expect(typeof layer).toBe("number");
      expect(layer).toBeGreaterThanOrEqual(0);
      expect(layer).toBeLessThanOrEqual(4);
      layers.add(layer as number);
    }
    expect(layers.size).toBe(5);
    expect(ARCH_LAYER_LABELS.length).toBe(5);
  });

  it("普通边方向向下,反向边全部标 feedback", () => {
    const g = buildArchitectureGraph({} as never);
    const layerOf = new Map(g.nodes.map((n) => {
      const nn = n as { id?: string; layer?: number; data?: { id?: string; layer?: number } };
      return [nn.id ?? nn.data?.id, nn.layer ?? nn.data?.layer] as const;
    }));
    for (const e of g.edges) {
      const ee = e as { source?: string; target?: string; feedback?: boolean; data?: { source?: string; target?: string; feedback?: boolean } };
      const s = layerOf.get(ee.source ?? ee.data?.source) ?? 0;
      const t = layerOf.get(ee.target ?? ee.data?.target) ?? 0;
      const fb = ee.feedback ?? ee.data?.feedback ?? false;
      if (!fb) expect(s).toBeLessThanOrEqual(t as number);
    }
  });

  it("client 接线:partitioning/taxi/聚焦/层带/按层按簇切换", () => {
    const client = clientSource();
    expect(client).toContain("elk.partitioning.activate");
    expect(client).toContain("nodeLayoutOptions");
    expect(client).toContain("taxi");
    expect(client).toContain("arch-dim");
    expect(client).toContain("按簇");
  });
});
