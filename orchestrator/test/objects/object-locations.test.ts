import { describe, it, expect } from "vitest";
import {
  OBJECT_LOCATIONS,
  objectDir,
  objectIdFromPath,
  objectPath,
  type KunpengObjectKind,
} from "../../src/objects/object-locations.js";

const ALL: KunpengObjectKind[] = [
  "agent",
  "artifact",
  "capture",
  "flow",
  "loop",
  "lock",
  "regression",
  "spec",
  "task",
  "worktree",
];

describe("OBJECT_LOCATIONS 集合锁定", () => {
  it("键集合恰好是约定的十项", () => {
    expect(Object.keys(OBJECT_LOCATIONS).sort()).toEqual([...ALL].sort());
  });

  it("每类的目录与扩展名逐项正确", () => {
    expect(OBJECT_LOCATIONS.flow).toEqual({ dir: "state", ext: ".json" });
    expect(OBJECT_LOCATIONS.spec).toEqual({ dir: "specs", ext: ".md" });
    expect(OBJECT_LOCATIONS.artifact).toEqual({ dir: "artifacts", ext: ".md" });
    expect(OBJECT_LOCATIONS.agent).toEqual({ dir: "agents-active", ext: ".md" });
    expect(OBJECT_LOCATIONS.task).toEqual({ dir: "tasks", ext: ".json" });
    expect(OBJECT_LOCATIONS.loop).toEqual({ dir: "loops", ext: ".json" });
    expect(OBJECT_LOCATIONS.capture).toEqual({ dir: "captures", ext: ".json" });
    expect(OBJECT_LOCATIONS.regression).toEqual({ dir: "regression", ext: ".json" });
    expect(OBJECT_LOCATIONS.lock).toEqual({ dir: "locks", ext: "" });
    expect(OBJECT_LOCATIONS.worktree).toEqual({ dir: "wt", ext: "" });
  });
});

describe("objectDir", () => {
  it("拼出含 .kunpeng 的目录", () => {
    expect(objectDir("/repo", "flow")).toBe("/repo/.kunpeng/state");
    expect(objectDir("/repo", "worktree")).toBe("/repo/.kunpeng/wt");
  });

  it("对每一类都能拼出目录且都在 .kunpeng 下", () => {
    for (const kind of ALL) {
      expect(objectDir("/repo", kind).startsWith("/repo/.kunpeng/")).toBe(true);
    }
  });
});

describe("objectPath", () => {
  it("文件型对象带扩展名", () => {
    expect(objectPath("/repo", "flow", "f-1")).toBe("/repo/.kunpeng/state/f-1.json");
    expect(objectPath("/repo", "spec", "s-1")).toBe("/repo/.kunpeng/specs/s-1.md");
  });

  it("目录型对象不带扩展名", () => {
    expect(objectPath("/repo", "worktree", "flow-a")).toBe("/repo/.kunpeng/wt/flow-a");
    expect(objectPath("/repo", "lock", "l-1")).toBe("/repo/.kunpeng/locks/l-1");
  });
});

describe("objectIdFromPath", () => {
  it("每一类都能往返", () => {
    for (const kind of ALL) {
      const id = "abc-123";
      expect(objectIdFromPath(kind, objectPath("/repo", kind, id))).toBe(id);
    }
  });

  it("扩展名不匹配时返回 null", () => {
    expect(objectIdFromPath("flow", "/repo/.kunpeng/state/f-1.md")).toBeNull();
    expect(objectIdFromPath("spec", "/repo/.kunpeng/specs/s-1.json")).toBeNull();
  });

  it("目录型对象直接返回 basename", () => {
    expect(objectIdFromPath("worktree", "/repo/.kunpeng/wt/flow-a")).toBe("flow-a");
  });

  it("id 里含点号时不被截断", () => {
    expect(objectIdFromPath("flow", "/repo/.kunpeng/state/a.b.c.json")).toBe("a.b.c");
  });
});