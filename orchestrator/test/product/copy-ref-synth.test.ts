import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { synthesizeFromRef, buildSynthPrompt } from "../../src/product/copy-ref-synth.js";
import { listProductsView } from "../../src/product/registry-service.js";
import { readSpec } from "../../src/product/loop-store.js";
import type { AgentRunner } from "../../src/agent/runner.js";

const fakeRunner: AgentRunner = {
  run: async () => ({ text: '前言噪声 {"problem":"P","users":["U"],"stories":["S"],"acceptance":["A"],"specMarkdown":"# 规格\\n目标：抄来的产品"} tokens used: 12', meta: {} }),
};

async function tmp(): Promise<string> { return mkdtemp(join(tmpdir(), "kp-synth-")); }

describe("synthesizeFromRef", () => {
  it("解析+LLM→建 copy-ref 产品+写 spec，返回 ia/themeColor/title", async () => {
    const root = await tmp();
    const ref = { rawHtml: "", markdown: "Linear is a tool", metadata: { title: "Linear", "theme-color": "#08090a" }, links: ["https://linear.app/", "https://linear.app/pricing"], host: "linear.app" };
    const r = await synthesizeFromRef(root, ref, fakeRunner, 1000);
    expect(r.title).toBe("Linear");
    expect(r.themeColor).toBe("#08090a");
    expect(r.ia).toContain("/pricing");
    const list = await listProductsView(root, 1000);
    expect(list.find((p) => p.slug === r.slug)?.sourceKind).toBe("copy-ref");
    const spec = await readSpec(root, r.slug);
    expect(spec).toContain("规格");
    await rm(root, { recursive: true, force: true });
  });

  it("无 metadata 标题 → title 回退 host", async () => {
    const root = await tmp();
    const ref = { rawHtml: "", markdown: "x", metadata: {}, links: [], host: "example.com" };
    const r = await synthesizeFromRef(root, ref, fakeRunner, 1);
    expect(r.title).toBe("example.com");
    await rm(root, { recursive: true, force: true });
  });
});

describe("buildSynthPrompt", () => {
  it("含标题与页面", () => {
    const p = buildSynthPrompt({ rawHtml: "", markdown: "m", metadata: {}, links: [], host: "h" }, ["/", "/pricing"], "Linear");
    expect(p).toContain("Linear");
    expect(p).toContain("/pricing");
  });
});