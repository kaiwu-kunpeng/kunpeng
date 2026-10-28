import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore } from "../../src/artifacts/store.js";
import { gateDiscoveredActions } from "../../src/web2mcp/connector-guard.js";
import type { ActionSpec } from "../../src/web2mcp/types.js";

const specs: ActionSpec[] = [
  {
    id: "a1",
    kind: "form",
    title: "登录提交",
    target: { url: "https://x.test/login", method: "POST" },
    params: [],
    needsAuth: true,
  },
  {
    id: "a2",
    kind: "network",
    title: "查询",
    target: { url: "https://x.test/api", method: "GET" },
    params: [],
    needsAuth: false,
  },
];

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "kp-web2mcp-guard-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("gates every discovered action when storage auth makes it sensitive", async () => {
  const store = new ArtifactStore(join(dir, "artifacts"));

  const result = await gateDiscoveredActions(store, specs, { sensitiveAccess: true });

  expect(result).toEqual({ gated: 2, total: 2 });
  const artifact = await store.read("connector-web2mcp-a1");
  expect(artifact.kind).toBe("connector");
  expect(artifact.status).toBe("draft");
  expect(artifact.body).toContain("登录提交");
});

test("does not write connector drafts without sensitive access", async () => {
  const store = new ArtifactStore(join(dir, "artifacts-no-auth"));

  const result = await gateDiscoveredActions(store, specs, { sensitiveAccess: false });

  expect(result).toEqual({ gated: 0, total: 2 });
  await expect(store.read("connector-web2mcp-a1")).rejects.toThrow();
  await expect(store.list("connector")).resolves.toEqual([]);
});
