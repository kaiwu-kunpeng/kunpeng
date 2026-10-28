import { describe, it, expect } from "vitest";
import { planMigration } from "../../src/project/profile-migrate.js";
describe("planMigration", () => {
  it("已有 profiles/→不迁移", () => {
    expect(planMigration({ stateDir:"/s", hasProfilesDir:true, hasLegacyProjects:true, legacyLoopIds:["a"] })).toEqual({ needed:false, moves:[], loopsToFlag:[] });
  });
  it("旧布局→三类 move + loop 全标记", () => {
    const p = planMigration({ stateDir:"/s", hasProfilesDir:false, hasLegacyProjects:true, legacyLoopIds:["l1","l2"] });
    expect(p.needed).toBe(true);
    expect(p.moves).toContainEqual({ from:"/s/projects.json", to:"/s/profiles/home/projects.json" });
    expect(p.moves).toContainEqual({ from:"/s/switchboard", to:"/s/shared/switchboard" });
    expect(p.moves).toContainEqual({ from:"/s/presence", to:"/s/shared/presence" });
    expect(p.loopsToFlag).toEqual(["l1","l2"]);
  });
  it("无旧 projects 但有 loop→仍迁移（不含 projects move）", () => {
    const p = planMigration({ stateDir:"/s", hasProfilesDir:false, hasLegacyProjects:false, legacyLoopIds:["l1"] });
    expect(p.needed).toBe(true);
    expect(p.moves.some(m => m.to.includes("projects.json"))).toBe(false);
    expect(p.loopsToFlag).toEqual(["l1"]);
  });
});
