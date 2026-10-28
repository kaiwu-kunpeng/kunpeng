import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Capture } from "../src/knowledge/capture-store.js";
import { startDashboard } from "../src/server/http.js";

let repo: string;

function capture(input: Partial<Capture> & Pick<Capture, "id" | "raw">): Capture {
  return {
    id: input.id,
    source: input.source ?? "text",
    kind: input.kind ?? "note",
    raw: input.raw,
    title: input.title,
    summary: input.summary,
    tags: input.tags ?? [],
    category: input.category,
    createdAt: input.createdAt ?? 1,
    promoted: input.promoted ?? false,
  };
}

function writeCapture(cap: Capture): void {
  writeFileSync(
    join(repo, ".kunpeng", "captures", `${encodeURIComponent(cap.id)}.json`),
    `${JSON.stringify(cap, null, 2)}\n`,
    "utf8",
  );
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
  repo = mkdtempSync(join(tmpdir(), "kp-http-knowledge-synthesize-"));
  mkdirSync(join(repo, ".kunpeng", "captures"), { recursive: true });
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

test("POST /api/knowledge-synthesize rejects missing topic", async () => {
  const srv = await startDashboard({ port: 0, repoRoot: repo });
  try {
    const body = await postJson(srv.port, "/api/knowledge-synthesize", { projectId: "current" });
    expect(body.ok).toBe(false);
    expect(String(body.error)).toContain("需指定");
  } finally {
    srv.close();
  }
});

test("POST /api/knowledge-synthesize returns empty brief without agent for no matching captures", async () => {
  const srv = await startDashboard({ port: 0, repoRoot: repo });
  try {
    const body = await postJson(srv.port, "/api/knowledge-synthesize", { projectId: "current", category: "战略" });
    expect(body.ok).toBe(true);
    expect(body.brief).toBe("该主题下还没有卡片。");
    expect(body.sources).toEqual([]);
  } finally {
    srv.close();
  }
});

test("POST /api/knowledge-synthesize connects store selection and returns sources when agent is unavailable", async () => {
  writeCapture(capture({ id: "cap-strategy-a", raw: "战略护城河资料 A", summary: "资料 A", category: "战略" }));
  writeCapture(capture({ id: "cap-strategy-b", raw: "战略护城河资料 B", title: "资料 B", category: "战略" }));
  writeCapture(capture({ id: "cap-tech", raw: "技术资料", category: "技术" }));

  const oldPath = process.env.PATH;
  process.env.PATH = "";
  const srv = await startDashboard({ port: 0, repoRoot: repo });
  try {
    const body = await postJson(srv.port, "/api/knowledge-synthesize", { projectId: "current", category: "战略" });
    expect(body.ok).toBe(true);
    expect(typeof body.brief).toBe("string");
    expect(body.sources.map((source: { id: string }) => source.id).sort()).toEqual(["cap-strategy-a", "cap-strategy-b"]);
  } finally {
    srv.close();
    if (oldPath === undefined) delete process.env.PATH;
    else process.env.PATH = oldPath;
  }
});
