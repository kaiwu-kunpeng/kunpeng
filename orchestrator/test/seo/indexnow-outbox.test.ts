import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { builtinSeoTools } from "../../src/seo/tools.js";
import { listOutbox } from "../../src/loop/outbox.js";
import type { SeoToolContext } from "../../src/seo/mcp-server.js";

let repo: string;
beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "kp-indexnow-outbox-")); });
afterEach(() => { rmSync(repo, { recursive: true, force: true }); });

describe("seo_indexnow_submit 只入 outbox 不外发（作者锁定）", () => {
  it("run → 入 indexnow 频道、去重、不带 key、不调 fetch；返回句柄", async () => {
    const tool = builtinSeoTools().find((t) => t.name === "seo_indexnow_submit")!;
    expect(tool.annotations).toEqual({ readOnlyHint: false, destructiveHint: true, openWorldHint: true });
    expect(tool.inputSchema.required).toEqual(["host", "urls"]);
    const fetchImpl = vi.fn(async () => new Response("", { status: 202 }));
    const ctx: SeoToolContext = { repoRoot: repo, fetchImpl: fetchImpl as unknown as typeof fetch, now: () => 1 };
    const out = JSON.parse(await tool.run({ host: "demo.ai", key: "k-secret-123", urls: ["https://demo.ai/a", "https://demo.ai/a", "https://demo.ai/b"] }, ctx));
    expect(out).toMatchObject({ queued: true, channel: "indexnow", urls: 2 });
    expect(typeof out.id).toBe("string");
    expect(fetchImpl).not.toHaveBeenCalled();
    const entries = listOutbox(repo, "indexnow");
    expect(entries).toHaveLength(1);
    expect(entries[0]!.payload).toEqual({ urls: ["https://demo.ai/a", "https://demo.ai/b"], host: "demo.ai" });
    const raw = readFileSync(join(repo, ".kunpeng", "outbox", "indexnow.json"), "utf8");
    expect(raw).not.toContain("k-secret-123");
  });

  it("源码不再直接外发", () => {
    const text = readFileSync(fileURLToPath(new URL("../../src/seo/tools.ts", import.meta.url)), "utf8");
    expect(text).toContain("enqueueOutbox(");
    expect(text).not.toContain("submitIndexNow(");
  });
});