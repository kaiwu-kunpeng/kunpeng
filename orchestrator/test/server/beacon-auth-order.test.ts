import { afterEach, beforeEach, expect, test } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDashboard } from "../../src/server/http.js";
import { beaconSecret, beaconToken } from "../../src/product/beacon-token.js";

let repo: string;
let stateDir: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "kp-beacon-authorder-"));
  stateDir = mkdtempSync(join(tmpdir(), "kp-beacon-state-"));
});
afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(stateDir, { recursive: true, force: true });
});

function enableAuth(): void {
  writeFileSync(
    join(stateDir, "auth.json"),
    JSON.stringify({ secret: "test-secret-for-beacon-order", accounts: [] }),
    "utf8",
  );
}

test("启用鉴权后 POST /api/beacon 无 cookie 返回 401 且不落盘", async () => {
  const slug = "demo";
  mkdirSync(join(repo, ".kunpeng", "product", slug), { recursive: true });
  enableAuth();
  const srv = await startDashboard({ port: 0, repoRoot: repo, stateDir });
  try {
    const res = await fetch(`http://127.0.0.1:${srv.port}/api/beacon`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug, kind: "pageview" }),
    });
    expect(res.status).toBe(401);
    expect(existsSync(join(repo, ".kunpeng", "product", slug, "ops-events.jsonl"))).toBe(false);
  } finally { srv.close(); }
});

test("启用鉴权后静态 GET /kp-beacon.js 仍返回 200", async () => {
  enableAuth();
  const srv = await startDashboard({ port: 0, repoRoot: repo, stateDir });
  try {
    const res = await fetch(`http://127.0.0.1:${srv.port}/kp-beacon.js?slug=demo`);
    expect(res.status).toBe(200);
  } finally { srv.close(); }
});

test("启用鉴权后 OPTIONS 预检仍返回 204", async () => {
  enableAuth();
  const srv = await startDashboard({ port: 0, repoRoot: repo, stateDir });
  try {
    const res = await fetch(`http://127.0.0.1:${srv.port}/api/beacon`, { method: "OPTIONS" });
    expect(res.status).toBe(204);
  } finally { srv.close(); }
});

test("未启用鉴权时 POST /api/beacon 仍 204 且正常落盘（向后兼容）", async () => {
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
    expect(existsSync(join(repo, ".kunpeng", "product", slug, "ops-events.jsonl"))).toBe(true);
  } finally { srv.close(); }
});
