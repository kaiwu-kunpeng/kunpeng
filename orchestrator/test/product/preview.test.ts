import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { resolvePreviewCommand, startPreview, readPreview, stopPreview } from "../../src/product/preview.js";

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.listen(0, () => {
      const port = (srv.address() as { port: number }).port;
      srv.close(() => resolve(port));
    });
  });
}

describe("resolvePreviewCommand", () => {
  it("优先 dev，其次 start，无则 undefined", () => {
    expect(resolvePreviewCommand({ scripts: { dev: "x", start: "y" } })?.script).toBe("dev");
    expect(resolvePreviewCommand({ scripts: { start: "y" } })?.script).toBe("start");
    expect(resolvePreviewCommand({ scripts: {} })).toBeUndefined();
    expect(resolvePreviewCommand({})).toBeUndefined();
  });
});

describe("startPreview / readPreview / stopPreview（真进程）", () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), "kp-preview-")); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it("起服务→探活→记录→停", async () => {
    writeFileSync(join(root, "package.json"), JSON.stringify({
      name: "fixture",
      scripts: { dev: "node -e \"require('http').createServer((q,s)=>s.end('ok')).listen(process.env.PORT)\"" },
    }));
    const port = await freePort();
    const info = await startPreview(root, "demo", { port });
    expect(info.port).toBe(port);
    expect(info.url).toContain(String(port));
    expect(existsSync(join(root, ".kunpeng", "product", "demo", "preview.json"))).toBe(true);
    const read = await readPreview(root, "demo");
    expect(read?.alive).toBe(true);
    expect(await stopPreview(root, "demo")).toBe(true);
    expect(await readPreview(root, "demo")).toBeUndefined();
  }, 30_000);

  it("无 dev/start 脚本时抛错", async () => {
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "empty", scripts: {} }));
    await expect(startPreview(root, "demo", { port: 1 })).rejects.toThrow(/dev\/start/);
  });
});