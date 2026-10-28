import { describe, it, expect } from "vitest";
import { inferProjectFromPath } from "../../src/project/infer.js";
describe("inferProjectFromPath", () => {
  it("上溯命中 .kunpeng/project.json 自描", () => {
    const readSelf = (dir: string) => dir === "/repo" ? { id: "acme-shop", name: "AcmeShop" } : null;
    const got = inferProjectFromPath("/repo/.kunpeng/wt/flow-x/orchestrator", { readSelf, registryEntries: () => [] });
    expect(got).toEqual({ id: "acme-shop", name: "AcmeShop", repoPath: "/repo" });
  });
  it("无自描则用 registry 最长前缀", () => {
    const got = inferProjectFromPath("/r/proj/sub", {
      readSelf: () => null,
      registryEntries: () => [{ id: "proj", name: "Proj", repoPath: "/r/proj" }, { id: "other", repoPath: "/r" }],
    });
    expect(got?.id).toBe("proj");
  });
  it("都无 → null", () => {
    expect(inferProjectFromPath("/nowhere", { readSelf: () => null, registryEntries: () => [] })).toBeNull();
  });
});
