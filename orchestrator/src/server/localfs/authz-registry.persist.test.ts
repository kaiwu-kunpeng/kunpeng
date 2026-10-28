import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createAuthzRegistry, type LocalFsAuthz } from "./authz-registry.js";

function entry(conv: string, overrides: Partial<LocalFsAuthz> = {}): LocalFsAuthz {
  return { conv, clientId: "cid-1", dirName: "用增", origin: "host", username: "admin", ts: Date.now(), ...overrides };
}

describe("localfs 授权登记表持久化:serve 重启不丢授权", () => {
  it("register 后新建实例(模拟重启)仍能读到授权", () => {
    const p = join(mkdtempSync(join(tmpdir(), "kp-authz-")), "authz.json");
    const a = createAuthzRegistry(500, false, p);
    a.register(entry("c1"));
    const b = createAuthzRegistry(500, false, p);
    expect(b.get("c1")?.clientId).toBe("cid-1");
    expect(b.get("c1")?.dirName).toBe("用增");
  });

  it("clear 也持久化:重启后不复活", () => {
    const p = join(mkdtempSync(join(tmpdir(), "kp-authz-")), "authz.json");
    const a = createAuthzRegistry(500, false, p);
    a.register(entry("c2"));
    a.clear("c2");
    const b = createAuthzRegistry(500, false, p);
    expect(b.get("c2")).toBeUndefined();
  });

  it("文件损坏时当空表且不抛,随后 register 可自愈", () => {
    const p = join(mkdtempSync(join(tmpdir(), "kp-authz-")), "authz.json");
    writeFileSync(p, "not-json{{{");
    const a = createAuthzRegistry(500, false, p);
    expect(a.get("c3")).toBeUndefined();
    a.register(entry("c3"));
    const b = createAuthzRegistry(500, false, p);
    expect(b.get("c3")?.conv).toBe("c3");
  });

  it("超过 7 天的过期条目在加载时被丢弃,新鲜条目保留", () => {
    const p = join(mkdtempSync(join(tmpdir(), "kp-authz-")), "authz.json");
    const stale = entry("old", { ts: Date.now() - 8 * 24 * 3600 * 1000 });
    const fresh = entry("new");
    writeFileSync(p, JSON.stringify([stale, fresh]));
    const a = createAuthzRegistry(500, false, p);
    expect(a.get("old")).toBeUndefined();
    expect(a.get("new")?.conv).toBe("new");
  });

  it("不传 persistPath:行为与现状一致(纯内存)", () => {
    const a = createAuthzRegistry();
    a.register(entry("mem"));
    expect(a.get("mem")?.conv).toBe("mem");
    expect(createAuthzRegistry().get("mem")).toBeUndefined();
  });
});