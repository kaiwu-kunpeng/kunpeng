import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore } from "../src/artifacts/store.js";
import { startDashboard } from "../src/server/http.js";

let repo: string;

const postApproveConnector = async (port: number, body: unknown) => {
  const res = await fetch(`http://127.0.0.1:${port}/api/approve-connector`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(res.headers.get("content-type")).toContain("application/json");
  return res.json();
};

beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "kp-approve-connector-")); });
afterEach(() => rmSync(repo, { recursive: true, force: true }));

test("POST /api/approve-connector approves a draft connector artifact", async () => {
  const store = new ArtifactStore(join(repo, ".kunpeng", "artifacts"));
  await store.write({ kind: "connector", id: "conn-1", status: "draft", body: "connector 动作：x", meta: {} });

  const srv = await startDashboard({ port: 0, repoRoot: repo });
  try {
    const body = await postApproveConnector(srv.port, { projectId: "current", id: "conn-1" });
    expect(body.ok).toBe(true);
    expect(body.note).toContain("conn-1");
  } finally {
    srv.close();
  }

  const after = await store.read("conn-1");
  expect(after.status).toBe("approved");
});

test("POST /api/approve-connector returns ok:false for an unknown artifact id", async () => {
  const srv = await startDashboard({ port: 0, repoRoot: repo });
  try {
    const body = await postApproveConnector(srv.port, { projectId: "current", id: "missing" });
    expect(body.ok).toBe(false);
    expect(typeof body.error).toBe("string");
    expect(body.error).toContain("missing");
  } finally {
    srv.close();
  }
});
