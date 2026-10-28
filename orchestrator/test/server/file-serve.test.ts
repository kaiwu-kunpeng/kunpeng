import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { safeResolve, listDir, serveFile } from "../../src/server/file-serve.js";

function mkRes() {
  const headers: Record<string, string> = {};
  let statusCode = 200;
  const sink = new Writable({ write(_c, _e, cb) { cb(); } }) as unknown as {
    setHeader: (k: string, v: string) => void; headers: Record<string, string>;
    statusCode: number; end: (x?: unknown) => void; headersSent: boolean;
    _done: Promise<void>;
  };
  let resolveDone: () => void;
  const done = new Promise<void>((r) => { resolveDone = r; });
  (sink as unknown as { setHeader: (k: string, v: string) => void }).setHeader = (k: string, v: string) => { headers[k.toLowerCase()] = v; };
  Object.defineProperty(sink, "statusCode", { get: () => statusCode, set: (v) => { statusCode = v; } });
  Object.defineProperty(sink, "headers", { get: () => headers });
  (sink as unknown as { headersSent: boolean }).headersSent = false;
  const origEnd = (sink as unknown as { end: (x?: unknown) => void }).end.bind(sink);
  (sink as unknown as { end: (x?: unknown) => void }).end = (x?: unknown) => { origEnd(x); resolveDone(); };
  (sink as unknown as { _done: Promise<void> })._done = done;
  return sink as unknown as { setHeader: (k: string, v: string) => void; headers: Record<string, string>; statusCode: number; end: (x?: unknown) => void; headersSent: boolean; _done: Promise<void> };
}

describe("safeResolve", () => {
  it("锁基目录,穿越返 null", () => {
    const base = "/tmp/base";
    expect(safeResolve(base, "a/b.txt")).toBe("/tmp/base/a/b.txt");
    expect(safeResolve(base, "../../etc/passwd")).toBeNull();
    expect(safeResolve(base, ".")).toBe("/tmp/base");
  });
});

describe("listDir", () => {
  it("跳隐藏文件,目录排前", async () => {
    const base = mkdtempSync(join(tmpdir(), "kp-fs-"));
    try {
      writeFileSync(join(base, "b.txt"), "x");
      writeFileSync(join(base, ".hidden"), "x");
      mkdirSync(join(base, "adir"));
      const r = await listDir(base, ".");
      expect(r.ok).toBe(true);
      const names = (r.entries ?? []).map((e) => e.name);
      expect(names).toContain("adir");
      expect(names).toContain("b.txt");
      expect(names).not.toContain(".hidden");
      expect((r.entries ?? [])[0].dir).toBe(true); // 目录优先
    } finally { rmSync(base, { recursive: true, force: true }); }
  });
  it("穿越目录返 forbidden", async () => {
    expect((await listDir("/tmp/base", "../..")).ok).toBe(false);
  });
});

describe("serveFile", () => {
  it("html → inline + CSP sandbox", async () => {
    const base = mkdtempSync(join(tmpdir(), "kp-fs2-"));
    try {
      writeFileSync(join(base, "x.html"), "<h1>hi</h1>");
      const res = mkRes();
      await serveFile(res as never, base, "x.html");
      await res._done;
      expect(res.headers["content-disposition"]).toContain("inline");
      expect(res.headers["content-security-policy"]).toContain("sandbox");
      expect(res.headers["content-type"]).toContain("text/html");
    } finally { rmSync(base, { recursive: true, force: true }); }
  });
  it("pptx → attachment 下载", async () => {
    const base = mkdtempSync(join(tmpdir(), "kp-fs3-"));
    try {
      writeFileSync(join(base, "d.pptx"), "PK");
      const res = mkRes();
      await serveFile(res as never, base, "d.pptx");
      await res._done;
      expect(res.headers["content-disposition"]).toContain("attachment");
    } finally { rmSync(base, { recursive: true, force: true }); }
  });
  it("缺文件 → 404,穿越 → 403", async () => {
    const base = mkdtempSync(join(tmpdir(), "kp-fs4-"));
    try {
      const r1 = mkRes(); await serveFile(r1 as never, base, "nope.txt"); await r1._done;
      expect(r1.statusCode).toBe(404);
      const r2 = mkRes(); await serveFile(r2 as never, base, "../../../etc/passwd"); await r2._done;
      expect(r2.statusCode).toBe(403);
    } finally { rmSync(base, { recursive: true, force: true }); }
  });
});

import { isPathWithinBase } from "../../src/server/file-serve.js";
describe("isPathWithinBase (软链逃逸防护)", () => {
  it("base 内/等于 base → true，越界 → false", () => {
    expect(isPathWithinBase("/a/b", "/a/b/c")).toBe(true);
    expect(isPathWithinBase("/a/b", "/a/b")).toBe(true);
    expect(isPathWithinBase("/a/b", "/a/other")).toBe(false);
    expect(isPathWithinBase("/a/b", "/etc/passwd")).toBe(false);
  });
});
