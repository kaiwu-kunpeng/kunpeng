import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore } from "../src/artifacts/store.js";
import { startDashboard } from "../src/server/http.js";

let repo: string;

const postConfirmRelease = async (port: number, body: unknown) => {
  const res = await fetch(`http://127.0.0.1:${port}/api/confirm-release`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(res.headers.get("content-type")).toContain("application/json");
  return res.json();
};

beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "kp-confirm-release-")); });
afterEach(() => rmSync(repo, { recursive: true, force: true }));

test("POST /api/confirm-release marks a draft release approved", async () => {
  const store = new ArtifactStore(join(repo, ".kunpeng", "artifacts"));
  await store.write({ kind: "release", id: "release-vx", status: "draft", body: "build", meta: {} });

  const srv = await startDashboard({ port: 0, repoRoot: repo });
  try {
    const first = await postConfirmRelease(srv.port, { projectId: "current", id: "release-vx" });
    expect(first.ok).toBe(false);
    expect(first.needConfirm).toBe(true);
    expect(typeof first.confirmToken).toBe("string");
    expect((await store.read("release-vx")).status).toBe("draft");

    const body = await postConfirmRelease(srv.port, { projectId: "current", id: "release-vx", confirmToken: first.confirmToken });
    expect(body.ok).toBe(true);
    expect(body.note).toContain("release-vx");
  } finally {
    srv.close();
  }

  const after = await store.read("release-vx");
  expect(after.status).toBe("approved");
});

test("POST /api/confirm-release returns ok:false for an unknown artifact id", async () => {
  const srv = await startDashboard({ port: 0, repoRoot: repo });
  try {
    const body = await postConfirmRelease(srv.port, { projectId: "current", id: "release-missing" });
    expect(body.ok).toBe(false);
    expect(typeof body.error).toBe("string");
  } finally {
    srv.close();
  }
});