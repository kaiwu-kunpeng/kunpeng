import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { loadPublicReports, matchPublicReport, tryServePublicReport } from "../../src/server/public-reports.js";

describe("loadPublicReports", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "pubrep-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("文件不存在返回空对象", () => {
    expect(loadPublicReports(dir)).toEqual({});
  });
  it("JSON 无效返回空对象", () => {
    writeFileSync(join(dir, "public-reports.json"), "{not json");
    expect(loadPublicReports(dir)).toEqual({});
  });
  it("顶层是数组返回空对象", () => {
    writeFileSync(join(dir, "public-reports.json"), JSON.stringify(["a.html"]));
    expect(loadPublicReports(dir)).toEqual({});
  });
  it("只保留合法条目", () => {
    writeFileSync(join(dir, "public-reports.json"), JSON.stringify({
      aikosolar: "aikosolar-seo-report-20260928.html",
      "bad slug": "x.html",
      Upper: "y.html",
      trav: "../secret.html",
      sub: "dir/a.html",
      txt: "notes.txt",
      num: 42,
    }));
    expect(loadPublicReports(dir)).toEqual({ aikosolar: "aikosolar-seo-report-20260928.html" });
  });
});

describe("matchPublicReport", () => {
  const map = { aikosolar: "r.html" };
  it("GET 与 HEAD 精确命中", () => {
    expect(matchPublicReport("GET", "/r/aikosolar", map)).toBe("r.html");
    expect(matchPublicReport("HEAD", "/r/aikosolar", map)).toBe("r.html");
  });
  it("其他方法、结尾斜杠、多余段、未知 slug 都不命中", () => {
    expect(matchPublicReport("POST", "/r/aikosolar", map)).toBeNull();
    expect(matchPublicReport("GET", "/r/aikosolar/", map)).toBeNull();
    expect(matchPublicReport("GET", "/r/aikosolar/x", map)).toBeNull();
    expect(matchPublicReport("GET", "/r/other", map)).toBeNull();
    expect(matchPublicReport("GET", "/x/r/aikosolar", map)).toBeNull();
  });
});

describe("tryServePublicReport over real HTTP", () => {
  let stateDir: string;
  let docsDir: string;
  let server: Server;
  let port: number;

  function call(method: string, path: string): Promise<{ status: number; headers: Record<string, unknown>; body: string }> {
    return new Promise((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port, method, path }, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => { body += c; });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      });
      req.on("error", reject);
      req.end();
    });
  }

  beforeEach(async () => {
    stateDir = mkdtempSync(join(tmpdir(), "pubrep-state-"));
    docsDir = mkdtempSync(join(tmpdir(), "pubrep-docs-"));
    writeFileSync(join(stateDir, "public-reports.json"), JSON.stringify({ aikosolar: "report.html", gone: "missing.html" }));
    writeFileSync(join(docsDir, "report.html"), "<!doctype html><title>PUBREP-MARKER</title>");
    writeFileSync(join(docsDir, "private.html"), "<!doctype html><title>PRIVATE</title>");
    server = createServer(async (req, res) => {
      const path = new URL(req.url ?? "/", "http://x").pathname;
      if (await tryServePublicReport(req, res, { stateDir, docsDir, path })) return;
      res.statusCode = 302;
      res.setHeader("location", "/login");
      res.end();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    port = (server.address() as AddressInfo).port;
  });
  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    rmSync(stateDir, { recursive: true, force: true });
    rmSync(docsDir, { recursive: true, force: true });
  });

  it("白名单报告 GET 返回 200、正文与安全响应头", async () => {
    const r = await call("GET", "/r/aikosolar");
    expect(r.status).toBe(200);
    expect(r.body).toContain("PUBREP-MARKER");
    expect(String(r.headers["content-type"])).toBe("text/html; charset=utf-8");
    expect(String(r.headers["x-robots-tag"])).toBe("noindex, nofollow");
    expect(String(r.headers["cache-control"])).toBe("no-store");
    expect(String(r.headers["referrer-policy"])).toBe("no-referrer");
    expect(String(r.headers["x-content-type-options"])).toBe("nosniff");
  });
  it("HEAD 返回 200 且无正文", async () => {
    const r = await call("HEAD", "/r/aikosolar");
    expect(r.status).toBe(200);
    expect(r.body).toBe("");
  });
  it("白名单外的 slug 交回原有逻辑（跳登录）", async () => {
    const r = await call("GET", "/r/private");
    expect(r.status).toBe(302);
    expect(String(r.headers["location"])).toBe("/login");
  });
  it("白名单内但文件缺失返回 404", async () => {
    const r = await call("GET", "/r/gone");
    expect(r.status).toBe(404);
    expect(r.body).toBe("not found");
  });
  it("非 /r/ 路径不处理", async () => {
    const r = await call("GET", "/doc?name=report.html");
    expect(r.status).toBe(302);
  });
});