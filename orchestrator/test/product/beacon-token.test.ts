import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { beaconSecret, beaconToken, verifyBeaconToken } from "../../src/product/beacon-token.js";
import { kpBeaconSnippet } from "../../src/product/ops-kit.js";

const httpSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "server", "http.ts"),
  "utf8",
);

const SECRET = "test-secret-abcdef0123456789";

describe("beaconToken 与 slug 绑定", () => {
  it("同 slug 同 secret 稳定", () => {
    expect(beaconToken("prod-a", SECRET)).toBe(beaconToken("prod-a", SECRET));
  });

  it("不同 slug 产出不同 token", () => {
    expect(beaconToken("prod-a", SECRET)).not.toBe(beaconToken("prod-b", SECRET));
  });

  it("长度为 32", () => {
    expect(beaconToken("prod-a", SECRET).length).toBe(32);
  });
});

describe("verifyBeaconToken", () => {
  it("正确 token 通过", () => {
    expect(verifyBeaconToken("prod-a", beaconToken("prod-a", SECRET), SECRET)).toBe(true);
  });

  it("A 的 token 写不了 B", () => {
    expect(verifyBeaconToken("prod-b", beaconToken("prod-a", SECRET), SECRET)).toBe(false);
  });

  it("错误/畸形 token 一律拒", () => {
    expect(verifyBeaconToken("prod-a", "x".repeat(32), SECRET)).toBe(false);
    expect(verifyBeaconToken("prod-a", "tooshort", SECRET)).toBe(false);
    expect(verifyBeaconToken("prod-a", undefined, SECRET)).toBe(false);
    expect(verifyBeaconToken("prod-a", 12345, SECRET)).toBe(false);
  });

  it("长度不符不抛错", () => {
    expect(() => verifyBeaconToken("prod-a", "abc", SECRET)).not.toThrow();
  });
});

describe("beaconSecret 落盘与读回", () => {
  it("首次生成、二次读回同一值", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kp-beacon-secret-"));
    const first = await beaconSecret(dir);
    expect(first.length).toBeGreaterThan(16);
    const second = await beaconSecret(dir);
    expect(second).toBe(first);
    const onDisk = (await readFile(join(dir, "beacon-secret"), "utf8")).trim();
    expect(onDisk).toBe(first);
    await rm(dir, { recursive: true, force: true });
  });
});

describe("脚本与接线", () => {
  it("生成的 JS 带 t 字段", () => {
    const js = kpBeaconSnippet("prod-a", "http://127.0.0.1:7788", beaconToken("prod-a", SECRET));
    expect(js).toContain("t:");
    expect(js).toContain(beaconToken("prod-a", SECRET));
  });

  it("serveBeaconIngest 已移回鉴权门之前", () => {
    const ingestIdx = httpSrc.indexOf("serveBeaconIngest(");
    const authIdx = httpSrc.indexOf("readAuthConfig(");
    expect(ingestIdx).toBeGreaterThan(-1);
    expect(authIdx).toBeGreaterThan(-1);
    expect(ingestIdx).toBeLessThan(authIdx);
  });
});

describe("端到端：无 token 一律拒收且不落盘（防 fail-open）", () => {
  it("不带 t、无鉴权配置时也必须 401 且不写文件", async () => {
    const { mkdtemp, mkdir, rm, access } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { startDashboard } = await import("../../src/server/http.js");
    const repo = await mkdtemp(join(tmpdir(), "kp-beacon-e2e-"));
    const state = await mkdtemp(join(tmpdir(), "kp-beacon-state-"));
    await mkdir(join(repo, ".kunpeng", "product", "demo"), { recursive: true });
    const srv = await startDashboard({ port: 0, repoRoot: repo, stateDir: state });
    try {
      const res = await fetch(`http://127.0.0.1:${srv.port}/api/beacon`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: "demo", kind: "pageview", name: "attacker" }),
      });
      expect(res.status, "无 token 必须 401").toBe(401);
      const wrote = await access(join(repo, ".kunpeng", "product", "demo", "ops-events.jsonl"))
        .then(() => true).catch(() => false);
      expect(wrote, "无 token 时绝不能落盘").toBe(false);
    } finally {
      srv.close();
      await rm(repo, { recursive: true, force: true });
      await rm(state, { recursive: true, force: true });
    }
  });

  it("错误 token 同样 401", async () => {
    const { mkdtemp, mkdir, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { startDashboard } = await import("../../src/server/http.js");
    const repo = await mkdtemp(join(tmpdir(), "kp-beacon-e2e2-"));
    const state = await mkdtemp(join(tmpdir(), "kp-beacon-state2-"));
    await mkdir(join(repo, ".kunpeng", "product", "demo"), { recursive: true });
    const srv = await startDashboard({ port: 0, repoRoot: repo, stateDir: state });
    try {
      const res = await fetch(`http://127.0.0.1:${srv.port}/api/beacon`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: "demo", kind: "pageview", t: "x".repeat(32) }),
      });
      expect(res.status).toBe(401);
    } finally {
      srv.close();
      await rm(repo, { recursive: true, force: true });
      await rm(state, { recursive: true, force: true });
    }
  });
});