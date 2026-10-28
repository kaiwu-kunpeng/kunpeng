import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CaptureStore } from "../src/knowledge/capture-store.js";
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
  repo = mkdtempSync(join(tmpdir(), "kp-http-knowledge-capture-"));
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

test("POST /api/knowledge-capture captures text and persists it", async () => {
  const srv = await startDashboard({ port: 0, repoRoot: repo });
  try {
    const body = await postJson(srv.port, "/api/knowledge-capture", {
      projectId: "current",
      text: "鲲鹏自建循环验证有效",
    });
    expect(body.ok).toBe(true);
    expect(body.id).toMatch(/^cap-/);
    expect(String(body.summary)).not.toHaveLength(0);
  } finally {
    srv.close();
  }

  const captures = await new CaptureStore(join(repo, ".kunpeng", "captures")).listCaptures();
  const capture = captures.find((item) => item.raw.includes("鲲鹏自建循环"));
  expect(capture).toBeDefined();
  expect(capture?.promoted).toBe(false);
});

test("POST /api/knowledge-capture rejects empty text", async () => {
  const srv = await startDashboard({ port: 0, repoRoot: repo });
  try {
    const body = await postJson(srv.port, "/api/knowledge-capture", { projectId: "current", text: "   " });
    expect(body.ok).toBe(false);
    expect(String(body.error)).toContain("捕获内容不能为空");
  } finally {
    srv.close();
  }
});
