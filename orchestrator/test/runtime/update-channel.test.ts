import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compareSemver, checkRemoteManifest, downloadUpdate, type UpdateManifest } from "../../src/runtime/update-channel.js";

const BODY = "包体";
const BODY_SHA = createHash("sha256").update(BODY).digest("hex");
const bodyFetch = (async () => ({ ok: true, arrayBuffer: async () => new TextEncoder().encode(BODY).buffer })) as unknown as typeof fetch;

describe("U2a:远程升级通道纯函数层", () => {
  it("compareSemver 三态", () => {
    expect(compareSemver("0.1.0", "0.2.0")).toBe(-1);
    expect(compareSemver("1.0.0", "1.0.0")).toBe(0);
    expect(compareSemver("1.10.0", "1.9.9")).toBe(1);
  });

  it("checkRemoteManifest 拉取清单,失败一律 null", async () => {
    const okFetch = (async () => ({ ok: true, json: async () => ({ version: "9.9.9", url: "https://x/kp.tgz", notes: "n" }) })) as unknown as typeof fetch;
    const m = await checkRemoteManifest("https://x/manifest.json", okFetch);
    expect(m?.version).toBe("9.9.9");
    const badFetch = (async () => { throw new Error("网络断"); }) as unknown as typeof fetch;
    expect(await checkRemoteManifest("https://x/manifest.json", badFetch)).toBeNull();
    const notOk = (async () => ({ ok: false, status: 500 })) as unknown as typeof fetch;
    expect(await checkRemoteManifest("https://x/manifest.json", notOk)).toBeNull();
    const noVersion = (async () => ({ ok: true, json: async () => ({}) })) as unknown as typeof fetch;
    expect(await checkRemoteManifest("https://x/manifest.json", noVersion)).toBeNull();
  });

  it("downloadUpdate 落盘 <dest>/<version>/<basename>", async () => {
    const dest = mkdtempSync(join(tmpdir(), "kp-upd-"));
    const manifest: UpdateManifest = { version: "9.9.9", url: "https://x/kp.tgz", sha256: BODY_SHA };
    const path = await downloadUpdate(manifest, dest, bodyFetch);
    expect(path).toContain(join(dest, "9.9.9"));
    expect(path.endsWith("kp.tgz")).toBe(true);
    expect(readFileSync(path, "utf8")).toBe(BODY);
  });

  it("缺 url 报错,下载非 ok 报错", async () => {
    await expect(downloadUpdate({ version: "1.0.0", sha256: BODY_SHA }, tmpdir())).rejects.toThrow(/url/i);
    const notOk = (async () => ({ ok: false, status: 404 })) as unknown as typeof fetch;
    await expect(downloadUpdate({ version: "1.0.0", url: "https://x/a.tgz", sha256: BODY_SHA }, mkdtempSync(join(tmpdir(), "kp-upd2-")), notOk)).rejects.toThrow();
  });
});

describe("R34:升级包 sha256 校验(fail-closed)", () => {
  it("checkRemoteManifest 透传合法 sha256,统一小写", async () => {
    const upper = BODY_SHA.toUpperCase();
    const f = (async () => ({ ok: true, json: async () => ({ version: "9.9.9", url: "https://x/kp.tgz", sha256: upper }) })) as unknown as typeof fetch;
    const m = await checkRemoteManifest("https://x/manifest.json", f);
    expect(m?.sha256).toBe(BODY_SHA);
  });

  it("checkRemoteManifest 丢弃形状不对的 sha256(不是 64 位十六进制)", async () => {
    const f = (async () => ({ ok: true, json: async () => ({ version: "9.9.9", url: "https://x/kp.tgz", sha256: "abc" }) })) as unknown as typeof fetch;
    const m = await checkRemoteManifest("https://x/manifest.json", f);
    expect(m?.version).toBe("9.9.9");
    expect(m?.sha256).toBeUndefined();
  });

  it("清单没给 sha256:拒绝下载,且根本不发起请求", async () => {
    const dest = mkdtempSync(join(tmpdir(), "kp-upd-nosha-"));
    let called = 0;
    const counting = (async () => { called += 1; return { ok: true, arrayBuffer: async () => new TextEncoder().encode(BODY).buffer }; }) as unknown as typeof fetch;
    await expect(downloadUpdate({ version: "9.9.9", url: "https://x/kp.tgz" }, dest, counting)).rejects.toThrow(/sha256/i);
    expect(called).toBe(0);
    expect(existsSync(join(dest, "9.9.9", "kp.tgz"))).toBe(false);
  });

  it("sha256 不匹配:报错且不留下任何包文件", async () => {
    const dest = mkdtempSync(join(tmpdir(), "kp-upd-bad-"));
    const wrong = "0".repeat(64);
    await expect(downloadUpdate({ version: "9.9.9", url: "https://x/kp.tgz", sha256: wrong }, dest, bodyFetch)).rejects.toThrow(/sha256/i);
    expect(existsSync(join(dest, "9.9.9", "kp.tgz"))).toBe(false);
    const leftovers = existsSync(join(dest, "9.9.9")) ? readdirSync(join(dest, "9.9.9")) : [];
    expect(leftovers).toEqual([]);
  });

  it("sha256 匹配(大小写不敏感):正常落盘", async () => {
    const dest = mkdtempSync(join(tmpdir(), "kp-upd-ok-"));
    const path = await downloadUpdate({ version: "9.9.9", url: "https://x/kp.tgz", sha256: BODY_SHA.toUpperCase() }, dest, bodyFetch);
    expect(readFileSync(path, "utf8")).toBe(BODY);
  });
});