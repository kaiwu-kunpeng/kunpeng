import { createServer, type Server } from "node:http";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { playwrightQaRunner, qaVerdict } from "../../src/product/browser-qa.js";

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });
}

describe.skipIf(process.env.KP_E2E !== "1")("playwrightQaRunner 真浏览器 e2e", () => {
  let root = "";
  let server: Server | undefined;

  afterEach(async () => {
    if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;
    if (root) rmSync(root, { recursive: true, force: true });
    root = "";
  });

  it("健康页面通过并产出截图", async () => {
    root = mkdtempSync(join(tmpdir(), "kp-qa-e2e-"));
    server = createServer((_req, res) => {
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end("<!doctype html><main><h1>Demo Preview</h1><p>页面内容足够长，浏览器 QA 应该通过。</p></main>");
    });
    const port = await listen(server);
    const outDir = join(root, ".kunpeng", "product", "demo");

    const result = await playwrightQaRunner(`http://127.0.0.1:${port}`, outDir);
    const verdict = qaVerdict(result.verdictInput);

    expect(verdict.ok).toBe(true);
    expect(result.screenshotPath).toBe(join(outDir, "preview.png"));
    expect(existsSync(result.screenshotPath ?? "")).toBe(true);
  });
});
