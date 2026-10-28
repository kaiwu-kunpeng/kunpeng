import { describe, expect, it } from "vitest";
import { httpSource } from "./helpers/http-source.js";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("Web Push 零依赖(作者验收)", () => {
  it("VAPID 密钥生成+公钥 base64url+JWT 三段", async () => {
    const push = await import("../src/server/push.js");
    const base = await mkdtemp(join(tmpdir(), "kp-push-"));
    await push.ensureVapidKeys(base);
    expect(existsSync(join(base, "push", "vapid.json"))).toBe(true);
    const key = push.publicKeyB64Url();
    expect(key.length).toBeGreaterThan(80);
    expect(key).not.toMatch(/[+/=]/);
    const jwt = push.signVapidJwt("https://fcm.googleapis.com");
    expect(jwt.split(".").length).toBe(3);
  });
  it("pending 队列 notify/drain 往返", async () => {
    const push = await import("../src/server/push.js");
    const base = await mkdtemp(join(tmpdir(), "kp-push2-"));
    await push.ensureVapidKeys(base);
    await push.notify({ kind: "done", title: "t", body: "b", url: "/#/x" });
    const drained = await push.drainPending();
    expect(drained.some((n: { title: string }) => n.title === "t")).toBe(true);
    expect((await push.drainPending()).length).toBe(0);
  });
  it("SW 带 push/notificationclick,路由文件在位", () => {
    const pwa = readFileSync(join(root, "src", "server", "pwa.ts"), "utf8");
    expect(pwa).toContain("addEventListener(\"push\"");
    expect(pwa).toContain("notificationclick");
    expect(existsSync(join(root, "src", "server", "routes", "push.ts"))).toBe(true);
    const httpSrc = httpSource();
    expect(httpSrc).toContain("routes/push.js");
  });
});
