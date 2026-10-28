import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CaptureStore, type Capture } from "../src/knowledge/capture-store.js";
import { startDashboard } from "../src/server/http.js";

let repo: string;

const capA: Capture = {
  id: "cap-a",
  source: "text",
  kind: "note",
  raw: "鲲鹏 进化 需要 durable-token-alpha 作为独有检索词。",
  summary: "鲲鹏进化知识卡片",
  tags: ["鲲鹏", "进化"],
  createdAt: 1000,
  promoted: false,
};

const capB: Capture = {
  id: "cap-b",
  source: "chat",
  kind: "note",
  raw: "另一条关于 cockpit 观察的记录。",
  title: "Cockpit 观察标题",
  summary: "cockpit 观察",
  tags: ["cockpit"],
  citedFrom: "https://example.test/cockpit",
  createdAt: 2000,
  promoted: false,
};

function writeCapture(capture: Capture): void {
  writeFileSync(
    join(repo, ".kunpeng", "captures", `${encodeURIComponent(capture.id)}.json`),
    `${JSON.stringify(capture, null, 2)}\n`,
    "utf8",
  );
}

async function getJson(port: number, path: string) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  expect(res.headers.get("content-type")).toContain("application/json");
  return res.json();
}

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
  repo = mkdtempSync(join(tmpdir(), "kp-http-knowledge-"));
  mkdirSync(join(repo, ".kunpeng", "captures"), { recursive: true });
  writeCapture(capA);
  writeCapture(capB);
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

test("GET /api/knowledge-search without q lists lightweight captures newest first", async () => {
  const srv = await startDashboard({ port: 0, repoRoot: repo });
  try {
    const body = await getJson(srv.port, "/api/knowledge-search?projectId=current");
    expect(body.ok).toBe(true);
    expect(body.captures.map((capture: { id: string }) => capture.id)).toEqual(["cap-b", "cap-a"]);
    expect(body.captures[0]).toEqual({
      id: "cap-b",
      title: "Cockpit 观察标题",
      summary: "cockpit 观察",
      source: "chat",
      tags: ["cockpit"],
      citedFrom: "https://example.test/cockpit",
      promoted: false,
      createdAt: 2000,
    });
    expect(body.captures[1]).toMatchObject({
      id: "cap-a",
      summary: "鲲鹏进化知识卡片",
      source: "text",
      tags: ["鲲鹏", "进化"],
      promoted: false,
      createdAt: 1000,
    });
  } finally {
    srv.close();
  }
});

test("GET /api/knowledge-search with q returns recall hits", async () => {
  const srv = await startDashboard({ port: 0, repoRoot: repo });
  try {
    const body = await getJson(
      srv.port,
      `/api/knowledge-search?projectId=current&q=${encodeURIComponent("durable-token-alpha")}`,
    );
    expect(body.ok).toBe(true);
    expect(body.hits.length).toBeGreaterThan(0);
    expect(body.hits[0].capture.id).toBe("cap-a");
    expect(typeof body.hits[0].citation.snippet).toBe("string");
  } finally {
    srv.close();
  }
});

test("POST /api/knowledge-promote promotes capture and persists it", async () => {
  const srv = await startDashboard({ port: 0, repoRoot: repo });
  try {
    const body = await postJson(srv.port, "/api/knowledge-promote", { projectId: "current", id: "cap-a" });
    expect(body.ok).toBe(true);
    expect(body.promoted).toBe(true);
  } finally {
    srv.close();
  }

  const captures = await new CaptureStore(join(repo, ".kunpeng", "captures")).listCaptures();
  expect(captures.find((capture) => capture.id === "cap-a")?.promoted).toBe(true);
});

test("POST /api/knowledge-promote returns ok:false for missing capture", async () => {
  const srv = await startDashboard({ port: 0, repoRoot: repo });
  try {
    const body = await postJson(srv.port, "/api/knowledge-promote", { projectId: "current", id: "missing" });
    expect(body.ok).toBe(false);
    expect(String(body.error)).toContain("missing");
  } finally {
    srv.close();
  }
});
