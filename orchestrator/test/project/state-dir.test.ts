import { describe, it, expect } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";
import { kunpengStateDir } from "../../src/project/state-dir.js";
import { kunpengStateDir as fromProfile } from "../../src/project/profile.js";
import { kunpengStateDir as fromRegistry } from "../../src/project/registry.js";

describe("kunpengStateDir 唯一实现", () => {
  it("未设置 KUNPENG_STATE → 回落 ~/.kunpeng", () => {
    expect(kunpengStateDir({} as NodeJS.ProcessEnv)).toBe(join(homedir(), ".kunpeng"));
  });

  it("设置 KUNPENG_STATE → 取该值", () => {
    expect(kunpengStateDir({ KUNPENG_STATE: "/var/lib/kunpeng" } as NodeJS.ProcessEnv)).toBe(
      "/var/lib/kunpeng",
    );
  });

  it("空串视作未设置(此前 ?? 会产出坏路径)", () => {
    expect(kunpengStateDir({ KUNPENG_STATE: "" } as NodeJS.ProcessEnv)).toBe(
      join(homedir(), ".kunpeng"),
    );
  });

  it("纯空白同样视作未设置", () => {
    expect(kunpengStateDir({ KUNPENG_STATE: "   " } as NodeJS.ProcessEnv)).toBe(
      join(homedir(), ".kunpeng"),
    );
  });

  it("profile.ts 与 registry.ts 再导出的是同一个函数引用(唯一实现)", () => {
    expect(fromProfile).toBe(kunpengStateDir);
    expect(fromRegistry).toBe(kunpengStateDir);
  });
});