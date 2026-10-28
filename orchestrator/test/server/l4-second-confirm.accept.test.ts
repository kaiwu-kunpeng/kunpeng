import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore } from "../../src/artifacts/store.js";
import { startDashboard } from "../../src/server/http.js";
import { CONFIRM_TOKEN_TTL_MS, consumeConfirmToken, issueConfirmToken } from "../../src/server/second-confirm.js";

let repo: string;

async function post(port: number, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`http://127.0.0.1:${port}/api/confirm-release`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "kp-l4-confirm-")); });
afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("二次确认令牌（作者锁定）", () => {
  test("一次性、绑定 key、过期失效", () => {
    const t = issueConfirmToken("p:a", 1_000);
    expect(t).toMatch(/^[0-9a-f]{32}$/);
    expect(consumeConfirmToken("p:b", t, 1_001)).toBe(false);
    expect(consumeConfirmToken("p:a", t, 1_001)).toBe(true);
    expect(consumeConfirmToken("p:a", t, 1_002)).toBe(false);
    const old = issueConfirmToken("p:a", 1_000);
    expect(consumeConfirmToken("p:a", old, 1_000 + CONFIRM_TOKEN_TTL_MS + 1)).toBe(false);
  });
});

describe("POST /api/confirm-release 服务端两步确认（作者锁定）", () => {
  test("单次请求不发布；带令牌第二次才发布；令牌不能重用", async () => {
    const store = new ArtifactStore(join(repo, ".kunpeng", "artifacts"));
    await store.write({ kind: "release", id: "release-v1", status: "draft", body: "build", meta: {} });
    const srv = await startDashboard({ port: 0, repoRoot: repo });
    try {
      const first = await post(srv.port, { projectId: "current", id: "release-v1" });
      expect(first.json.ok).toBe(false);
      expect(first.json.needConfirm).toBe(true);
      expect(typeof first.json.confirmToken).toBe("string");
      expect((await store.read("release-v1")).status).toBe("draft");

      const forged = await post(srv.port, { projectId: "current", id: "release-v1", confirmToken: "deadbeef" });
      expect(forged.json.ok).toBe(false);
      expect((await store.read("release-v1")).status).toBe("draft");

      const second = await post(srv.port, { projectId: "current", id: "release-v1", confirmToken: first.json.confirmToken });
      expect(second.json.ok).toBe(true);
      expect(String(second.json.note)).toContain("release-v1");
      expect((await store.read("release-v1")).status).toBe("approved");

      const replay = await post(srv.port, { projectId: "current", id: "release-v1", confirmToken: first.json.confirmToken });
      expect(replay.json.ok).toBe(false);
    } finally {
      srv.close();
    }
  });

  test("令牌不能挪给另一个发布用", async () => {
    const store = new ArtifactStore(join(repo, ".kunpeng", "artifacts"));
    await store.write({ kind: "release", id: "rel-a", status: "draft", body: "a", meta: {} });
    await store.write({ kind: "release", id: "rel-b", status: "draft", body: "b", meta: {} });
    const srv = await startDashboard({ port: 0, repoRoot: repo });
    try {
      const first = await post(srv.port, { projectId: "current", id: "rel-a" });
      const cross = await post(srv.port, { projectId: "current", id: "rel-b", confirmToken: first.json.confirmToken });
      expect(cross.json.ok).toBe(false);
      expect((await store.read("rel-b")).status).toBe("draft");
    } finally {
      srv.close();
    }
  });

  test("合成证据 → 409，带不带令牌都不发布", async () => {
    const store = new ArtifactStore(join(repo, ".kunpeng", "artifacts"));
    await store.write({ kind: "release", id: "rel-syn", status: "draft", body: "x", meta: { syntheticEvidence: true } });
    const srv = await startDashboard({ port: 0, repoRoot: repo });
    try {
      const first = await post(srv.port, { projectId: "current", id: "rel-syn" });
      expect(first.status).toBe(409);
      expect(first.json.ok).toBe(false);
      expect(String(first.json.error)).toContain("合成证据");
      const token = issueConfirmToken("current:rel-syn");
      const second = await post(srv.port, { projectId: "current", id: "rel-syn", confirmToken: token });
      expect(second.status).toBe(409);
      expect((await store.read("rel-syn")).status).toBe("draft");
    } finally {
      srv.close();
    }
  });
});