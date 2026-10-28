import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore } from "../src/artifacts/store.js";
import { startDashboard } from "../src/server/http.js";

let repo: string;

const postReject = async (port: number, body: unknown) => {
  const res = await fetch(`http://127.0.0.1:${port}/api/reject`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(res.headers.get("content-type")).toContain("application/json");
  return res.json();
};

beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "kp-reject-")); });
afterEach(() => rmSync(repo, { recursive: true, force: true }));

test("POST /api/reject marks a draft proposal rolled-back", async () => {
  const store = new ArtifactStore(join(repo, ".kunpeng", "artifacts"));
  await store.write({ kind: "proposal", id: "p1", status: "draft", body: "提案正文", meta: {} });

  const srv = await startDashboard({ port: 0, repoRoot: repo });
  try {
    const body = await postReject(srv.port, { projectId: "current", id: "p1" });
    expect(body).toEqual({ ok: true, note: "提案已拒绝（记为 rolled-back，不再进人审队列）" });
  } finally {
    srv.close();
  }

  const after = await store.read("p1");
  expect(after.status).toBe("rolled-back");
});

test("POST /api/reject returns ok:false for an unknown artifact id", async () => {
  const srv = await startDashboard({ port: 0, repoRoot: repo });
  try {
    const body = await postReject(srv.port, { projectId: "current", id: "missing" });
    expect(body.ok).toBe(false);
    expect(String(body.error)).toContain("missing");
  } finally {
    srv.close();
  }
});
