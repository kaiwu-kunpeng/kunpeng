import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore } from "../../src/artifacts/store.js";
import { startDashboard } from "../../src/server/http.js";

let repo: string;

async function post(port: number, path: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

function decisionLines(): string[] {
  const file = join(repo, ".kunpeng", "audit", "decisions.jsonl");
  return existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean) : [];
}

beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "kp-approve-kind-")); });
afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("/api/approve 拒收 release 与 connector（作者锁定）", () => {
  test("release 草稿走通用批准 → 409，仍是 draft，不写决策行", async () => {
    const store = new ArtifactStore(join(repo, ".kunpeng", "artifacts"));
    await store.write({ kind: "release", id: "release-vx", status: "draft", body: "build", meta: { syntheticEvidence: true } });
    const srv = await startDashboard({ port: 0, repoRoot: repo });
    try {
      const res = await post(srv.port, "/api/approve", { projectId: "current", id: "release-vx" });
      expect(res.status).toBe(409);
      expect(res.json.ok).toBe(false);
      expect(String(res.json.error)).toContain("release");
      expect((await store.read("release-vx")).status).toBe("draft");
      expect(decisionLines()).toEqual([]);
    } finally {
      srv.close();
    }
  });

  test("connector 草稿走通用批准 → 409，仍是 draft", async () => {
    const store = new ArtifactStore(join(repo, ".kunpeng", "artifacts"));
    await store.write({ kind: "connector", id: "conn-x", status: "draft", body: "connector 动作", meta: {} });
    const srv = await startDashboard({ port: 0, repoRoot: repo });
    try {
      const res = await post(srv.port, "/api/approve", { projectId: "current", id: "conn-x" });
      expect(res.status).toBe(409);
      expect(res.json.ok).toBe(false);
      expect(String(res.json.error)).toContain("connector");
      expect((await store.read("conn-x")).status).toBe("draft");
    } finally {
      srv.close();
    }
  });

  test("提案照常批准", async () => {
    const store = new ArtifactStore(join(repo, ".kunpeng", "artifacts"));
    await store.write({ kind: "proposal", id: "p-ok", status: "draft", body: "提案", meta: {} });
    const srv = await startDashboard({ port: 0, repoRoot: repo });
    try {
      const res = await post(srv.port, "/api/approve", { projectId: "current", id: "p-ok" });
      expect(res.status).toBe(200);
      expect(res.json.ok).toBe(true);
      expect((await store.read("p-ok")).status).toBe("approved");
      expect(decisionLines().length).toBe(1);
    } finally {
      srv.close();
    }
  });
});

describe("/api/approve-connector 只放行 connector（作者锁定）", () => {
  test.each(["release", "proposal"] as const)("%s 走 connector 放行 → 409，仍是 draft", async (kind) => {
    const store = new ArtifactStore(join(repo, ".kunpeng", "artifacts"));
    await store.write({ kind, id: `x-${kind}`, status: "draft", body: "x", meta: {} });
    const srv = await startDashboard({ port: 0, repoRoot: repo });
    try {
      const res = await post(srv.port, "/api/approve-connector", { projectId: "current", id: `x-${kind}` });
      expect(res.status).toBe(409);
      expect(res.json.ok).toBe(false);
      expect(String(res.json.error)).toContain(kind);
      expect((await store.read(`x-${kind}`)).status).toBe("draft");
      expect(decisionLines()).toEqual([]);
    } finally {
      srv.close();
    }
  });

  test("未知 id 仍是 200 + ok:false", async () => {
    const srv = await startDashboard({ port: 0, repoRoot: repo });
    try {
      const res = await post(srv.port, "/api/approve-connector", { projectId: "current", id: "nope" });
      expect(res.status).toBe(200);
      expect(res.json.ok).toBe(false);
    } finally {
      srv.close();
    }
  });
});