import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDashboard } from "../src/server/http.js";

let repo: string;

async function postJson(port: number, path: string, body: unknown) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(res.headers.get("content-type")).toContain("application/json");
  return res.json();
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "kp-http-design-advise-"));
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

test("POST /api/design-advise rejects empty brief", async () => {
  const srv = await startDashboard({ port: 0, repoRoot: repo });
  try {
    const body = await postJson(srv.port, "/api/design-advise", { brief: "" });
    expect(body.ok).toBe(false);
    expect(String(body.error)).toContain("不能为空");
  } finally {
    srv.close();
  }
});

test("POST /api/design-advise returns design pipeline advice for a brief", async () => {
  const srv = await startDashboard({ port: 0, repoRoot: repo });
  try {
    const body = await postJson(srv.port, "/api/design-advise", { brief: "金融SaaS落地页" });
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.styles)).toBe(true);
    expect(body.styles.length).toBeGreaterThan(0);
    expect(body.palette.primary).toBeTruthy();
    expect(String(body.masterMd)).toContain("MASTER");
    expect(String(body.css)).toContain(":root");
    expect(Array.isArray(body.antiPatternHits)).toBe(true);
  } finally {
    srv.close();
  }
});
