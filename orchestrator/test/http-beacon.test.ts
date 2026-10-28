import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDashboard } from "../src/server/http.js";
import { beaconSecret, beaconToken } from "../src/product/beacon-token.js";

let repo: string;
let stateDir: string;
beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "kp-beacon-"));
  stateDir = join(repo, "state");
  mkdirSync(stateDir);
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

test("OPTIONS /api/beacon 返回 204 带 CORS 头（鉴权前）", async () => {
  const srv = await startDashboard({ port: 0, repoRoot: repo, stateDir });
  try {
    const res = await fetch(`http://127.0.0.1:${srv.port}/api/beacon`, { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect((res.headers.get("access-control-allow-headers") ?? "").toLowerCase()).toContain("content-type");
  } finally { srv.close(); }
});

test("GET /kp-beacon.js 返回纯 JS（无 script 标签）且 content-type 正确", async () => {
  const srv = await startDashboard({ port: 0, repoRoot: repo, stateDir });
  try {
    const res = await fetch(`http://127.0.0.1:${srv.port}/kp-beacon.js?slug=demo`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("application/javascript");
    const body = await res.text();
    expect(body).not.toContain("<script>");
    expect(body).not.toContain("</script>");
    expect(body).toContain("/api/beacon");
    expect(body).toContain("demo");
  } finally { srv.close(); }
});

test("POST /api/beacon 把 pageview 落到产品 ops-events 并返回 204+CORS", async () => {
  const slug = "demo";
  mkdirSync(join(repo, ".kunpeng", "product", slug), { recursive: true });
  const token = beaconToken(slug, await beaconSecret(stateDir));
  const srv = await startDashboard({ port: 0, repoRoot: repo, stateDir });
  try {
    const res = await fetch(`http://127.0.0.1:${srv.port}/api/beacon`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug, kind: "pageview", t: token }),
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const events = readFileSync(join(repo, ".kunpeng", "product", slug, "ops-events.jsonl"), "utf8");
    expect(events).toContain('"kind":"pageview"');
  } finally { srv.close(); }
});

test("POST /api/beacon 产品目录不存在也返回 204（防探测）", async () => {
  const slug = "nodir";
  const token = beaconToken(slug, await beaconSecret(stateDir));
  const srv = await startDashboard({ port: 0, repoRoot: repo, stateDir });
  try {
    const res = await fetch(`http://127.0.0.1:${srv.port}/api/beacon`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug, kind: "pageview", t: token }),
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  } finally { srv.close(); }
});

test("POST /api/beacon body 超 1KB 返回 413", async () => {
  const slug = "demo";
  const token = beaconToken(slug, await beaconSecret(stateDir));
  const srv = await startDashboard({ port: 0, repoRoot: repo, stateDir });
  try {
    const res = await fetch(`http://127.0.0.1:${srv.port}/api/beacon`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug, kind: "event", name: "x".repeat(2000), t: token }),
    });
    expect(res.status).toBe(413);
  } finally { srv.close(); }
});
