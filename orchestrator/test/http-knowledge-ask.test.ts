import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Capture } from "../src/knowledge/capture-store.js";
import { startDashboard } from "../src/server/http.js";

let repo: string;

const moatCapture: Capture = {
  id: "cap-moat",
  source: "text",
  kind: "note",
  raw: "循环工程是护城河。护城河来自持续验证、经验沉淀和自动化闭环。",
  title: "循环工程",
  summary: "循环工程是护城河",
  tags: ["护城河", "循环工程"],
  createdAt: 1000,
  promoted: false,
};

function writeCapture(capture: Capture): void {
  writeFileSync(
    join(repo, ".kunpeng", "captures", `${encodeURIComponent(capture.id)}.json`),
    `${JSON.stringify(capture, null, 2)}\n`,
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
  repo = mkdtempSync(join(tmpdir(), "kp-http-knowledge-ask-"));
  mkdirSync(join(repo, ".kunpeng", "captures"), { recursive: true });
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

test("POST /api/knowledge-ask rejects empty question", async () => {
  const srv = await startDashboard({ port: 0, repoRoot: repo });
  try {
    const body = await postJson(srv.port, "/api/knowledge-ask", { projectId: "current", question: "" });
    expect(body.ok).toBe(false);
    expect(String(body.error)).toContain("不能为空");
  } finally {
    srv.close();
  }
});

test("POST /api/knowledge-ask returns no-hit answer without agent", async () => {
  const srv = await startDashboard({ port: 0, repoRoot: repo });
  try {
    const body = await postJson(srv.port, "/api/knowledge-ask", { projectId: "current", question: "随便问" });
    expect(body.ok).toBe(true);
    expect(body.sources).toEqual([]);
    expect(String(body.answer)).toContain("没找到");
  } finally {
    srv.close();
  }
});

test("POST /api/knowledge-ask connects real recall and returns structured JSON when agent is unavailable", async () => {
  writeCapture(moatCapture);
  const oldPath = process.env.PATH;
  process.env.PATH = "";
  const srv = await startDashboard({ port: 0, repoRoot: repo });
  try {
    const body = await postJson(srv.port, "/api/knowledge-ask", { projectId: "current", question: "护城河" });
    if (body.ok === true) {
      expect(body.sources.map((source: { id: string }) => source.id)).toContain("cap-moat");
      expect(typeof body.answer).toBe("string");
    } else {
      expect(body.ok).toBe(false);
      expect(String(body.error)).not.toBe("");
    }
  } finally {
    srv.close();
    if (oldPath === undefined) delete process.env.PATH;
    else process.env.PATH = oldPath;
  }
});
