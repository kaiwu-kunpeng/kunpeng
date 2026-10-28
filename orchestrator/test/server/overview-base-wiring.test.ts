import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("总览底座接线（作者锁定）", () => {
  it("view-state 多项目分支与 snapshots 多快照分支都展开 aggregateOverviewBase", () => {
    const viewState = readFileSync(new URL("../../src/server/view-state.ts", import.meta.url), "utf8");
    const snapshots = readFileSync(new URL("../../src/server/snapshots.ts", import.meta.url), "utf8");
    expect(viewState).toContain("...aggregateOverviewBase(snaps)");
    expect(viewState.indexOf("...base,")).toBeLessThan(viewState.indexOf("...aggregateOverviewBase(snaps)"));
    expect(viewState.indexOf("...aggregateOverviewBase(snaps)")).toBeLessThan(viewState.indexOf("self: selfSnap"));
    expect(snapshots).toContain("...aggregateOverviewBase(snapshots)");
  });
});