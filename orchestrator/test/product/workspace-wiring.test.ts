import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { startPreview, stopPreview } from "../../src/product/preview.js";
import { buildSpecPrompt } from "../../src/product/spec-to-buildspec.js";
import { httpSource } from "../helpers/http-source.js";

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.listen(0, () => {
      const port = (srv.address() as { port: number }).port;
      srv.close(() => resolve(port));
    });
  });
}

describe("产品仓军规进提示词", () => {
  it("buildSpecPrompt 含独立小仓路径军规", () => {
    const p = buildSpecPrompt("# spec");
    expect(p).toContain("独立小仓");
    expect(p).toContain("orchestrator/");
  });
});

describe("startPreview cwd 指向工作区", () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), "kp-wsw-")); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it("宿主根无 package.json 时仍能从 cwd 起服务，状态落宿主", async () => {
    const ws = join(root, "products", "demo");
    mkdirSync(ws, { recursive: true });
    writeFileSync(join(ws, "package.json"), JSON.stringify({
      name: "ws-fixture",
      scripts: { dev: "node -e \"require('http').createServer((q,s)=>s.end('ws-ok')).listen(process.env.PORT)\"" },
    }));
    const port = await freePort();
    const info = await startPreview(root, "demo", { port, cwd: ws });
    expect(info.port).toBe(port);
    expect(existsSync(join(root, ".kunpeng", "product", "demo", "preview.json"))).toBe(true);
    expect(await stopPreview(root, "demo")).toBe(true);
  }, 30_000);
});

describe("源级接线", () => {
  it("http.ts：build 指向工作区/注册子项目/QA与存档打 commit/恢复端点", () => {
    const src = httpSource();
    expect(src).toContain("ensureWorkspace");
    expect(src).toContain("registerProject");
    expect(src).toContain("commitWorkspaceVersion");
    expect(src).toContain("/api/product/ws-restore");
  });
});
