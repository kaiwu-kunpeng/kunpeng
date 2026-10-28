import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 入口域名 public.example 解析成公网地址，其余照旧走真 DNS。
vi.mock("node:dns/promises", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:dns/promises")>();
  const lookup = (async (host: string, opts?: unknown) => {
    if (host === "public.example") return [{ address: "93.184.216.34", family: 4 }];
    return (real.lookup as (h: string, o?: unknown) => Promise<unknown>)(host, opts);
  }) as typeof real.lookup;
  return { ...real, lookup, default: { ...real, lookup } };
});

// 测试里不调真模型：整理失败会走确定性兜底摘要。
vi.mock("../../src/agent/cli-runner.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/agent/cli-runner.js")>();
  class StubRunner {
    async run(): Promise<never> { throw new Error("测试不调模型"); }
  }
  return { ...real, CliRunner: StubRunner };
});

const { startDashboard } = await import("../../src/server/http.js");

function listen(handler: Parameters<typeof createServer>[1]): Promise<{ server: Server; port: number }> {
  const server = createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, port: (server.address() as AddressInfo).port }));
  });
}

let repo: string;
let secretHits = 0;
let entryHits = 0;
let secret: { server: Server; port: number };
let entry: { server: Server; port: number };
const realFetch = globalThis.fetch;

beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "kp-knowledge-ssrf-"));
  secretHits = 0;
  entryHits = 0;
  vi.stubEnv("XCRAWL_MCP_URL", "");
  secret = await listen((_req, res) => {
    secretHits += 1;
    res.end("TOP-SECRET-ADMIN-TOKEN");
  });
  entry = await listen((req, res) => {
    entryHits += 1;
    if (req.url === "/jump") {
      res.statusCode = 302;
      res.setHeader("location", ["http://", "127.0.0.1", `:${secret.port}/secret`].join(""));
      res.end();
      return;
    }
    res.setHeader("content-type", "text/html");
    res.end("<html><title>DemoTravel 指南</title><body>DemoTravel 公开页面正文</body></html>");
  });
  // public.example 的真实流量落到本地入口 server；其余请求原样放行（含测试自己打 cockpit）。
  vi.stubGlobal("fetch", ((input: string | URL | Request, init?: RequestInit) => {
    const u = new URL(input instanceof Request ? input.url : String(input));
    if (u.hostname === "public.example") {
      return realFetch(`http://127.0.0.1:${entry.port}${u.pathname}`, init);
    }
    return realFetch(input, init);
  }) as typeof fetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  secret.server.close();
  entry.server.close();
  rmSync(repo, { recursive: true, force: true });
});

async function capture(port: number, value: string): Promise<{ ok: boolean; error?: string }> {
  const res = await realFetch(`http://127.0.0.1:${port}/api/knowledge-capture`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId: "current", kind: "url", value }),
  });
  return (await res.json()) as { ok: boolean; error?: string };
}

describe("知识库 URL 抓取逐跳过 SSRF 闸（作者锁定）", () => {
  test("公网入口 302 到回环地址：拒绝，且回环上的 secret 端点从未被请求", async () => {
    const srv = await startDashboard({ port: 0, repoRoot: repo });
    try {
      const body = await capture(srv.port, "http://public.example/jump");
      expect(entryHits).toBe(1);
      expect(body.ok).toBe(false);
      expect(String(body.error)).toMatch(/内网|回环/);
      expect(secretHits).toBe(0);
    } finally {
      srv.close();
    }
  });

  test("没有重定向的公网页面照常抓取成功", async () => {
    const srv = await startDashboard({ port: 0, repoRoot: repo });
    try {
      const body = await capture(srv.port, "http://public.example/page");
      expect(body.ok).toBe(true);
      expect(entryHits).toBe(1);
      expect(secretHits).toBe(0);
    } finally {
      srv.close();
    }
  });

  test("入口本身是回环地址：直接拒绝，不发请求", async () => {
    const srv = await startDashboard({ port: 0, repoRoot: repo });
    try {
      const body = await capture(srv.port, ["http://", "127.0.0.1", `:${secret.port}/secret`].join(""));
      expect(body.ok).toBe(false);
      expect(secretHits).toBe(0);
    } finally {
      srv.close();
    }
  });
});