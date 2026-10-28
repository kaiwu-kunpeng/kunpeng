import { isRecord } from "../util/is-record.js";
import { createRequire } from "node:module";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeTierProbe } from "./tier-signals.js";
import type { TierSignalProbe, RawTierSignals, ProbeTarget } from "./tier-signals.js";
import type { AgentRunner } from "../agent/runner.js";
import { extractFirstJsonObject } from "../util/extract-json.js";

interface BrowserPerfSnapshot {
  lcpMs: number;
  cls: number;
  tbtMs: number;
}

interface AxeRunResult {
  violations?: { id: string; impact?: string }[];
}

interface PngImage {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
}

interface PngModule {
  PNG: {
    sync: {
      read(buffer: Buffer): PngImage;
    };
  };
}

type Pixelmatch = (
  img1: Uint8Array | Uint8ClampedArray,
  img2: Uint8Array | Uint8ClampedArray,
  output: Uint8Array | Uint8ClampedArray | null,
  width: number,
  height: number,
  options?: { threshold?: number },
) => number;

declare global {
  interface Window {
    __perf?: BrowserPerfSnapshot;
    axe?: { run(): Promise<AxeRunResult> };
  }
}

async function loadOptional(name: string): Promise<unknown> {
  return import(name);
}

function numberFrom(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

function axeViolationsFrom(value: unknown): RawTierSignals["axeViolations"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== "string") return [];
    return [{ id: item.id, impact: typeof item.impact === "string" ? item.impact : undefined }];
  });
}

export interface PlaywrightProbeOptions {
  viewport?: { width: number; height: number };
  baselinePath?: string;
  baselineChanged?: boolean;
}

export class PlaywrightTierProbe implements TierSignalProbe {
  constructor(private opts: PlaywrightProbeOptions = {}) {}

  async probe(target: ProbeTarget): Promise<RawTierSignals> {
    if (!target.url && !target.html) {
      throw new Error("ProbeTarget 需 html 或 url 之一");
    }

    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: this.opts.viewport ?? { width: 1200, height: 800 },
      });

      let totalBytes = 0;
      page.on("response", async (res) => {
        try {
          totalBytes += (await res.body()).length;
        } catch (error) {
          void error;
        }
      });

      await page.addInitScript(() => {
        const perf = { lcpMs: 0, cls: 0, tbtMs: 0 };
        window.__perf = perf;
        try {
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              const metric = entry as PerformanceEntry & { renderTime?: number; loadTime?: number };
              perf.lcpMs = metric.renderTime || metric.loadTime || metric.startTime || 0;
            }
          }).observe({ type: "largest-contentful-paint", buffered: true });
        } catch (error) {
          void error;
        }
        try {
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              const shift = entry as PerformanceEntry & { hadRecentInput?: boolean; value?: number };
              if (!shift.hadRecentInput) perf.cls += shift.value || 0;
            }
          }).observe({ type: "layout-shift", buffered: true });
        } catch (error) {
          void error;
        }
        try {
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              perf.tbtMs += Math.max(0, entry.duration - 50);
            }
          }).observe({ type: "longtask", buffered: true });
        } catch (error) {
          void error;
        }
      });

      if (target.url) {
        await page.goto(target.url, { waitUntil: "networkidle" });
      } else {
        await page.setContent(target.html ?? "", { waitUntil: "networkidle" });
      }
      await page.waitForTimeout(200);

      const p = await page.evaluate(
        () => window.__perf ?? { lcpMs: 0, cls: 0, tbtMs: 0 },
      );
      const perfMetrics = {
        lcpMs: Math.round(p.lcpMs ?? 0),
        cls: p.cls ?? 0,
        tbtMs: Math.round(p.tbtMs ?? 0),
        totalBytes,
      };

      const require2 = createRequire(import.meta.url);
      const axeSrc = await readFile(require2.resolve("axe-core/axe.min.js"), "utf8");
      await page.addScriptTag({ content: axeSrc });
      const result = await page.evaluate(async () => {
        if (!window.axe) throw new Error("axe-core 未加载");
        return await window.axe.run();
      });
      const axeViolations = (result.violations ?? []).map((v) => ({
        id: v.id,
        impact: v.impact,
      }));

      let visualDiff: RawTierSignals["visualDiff"];
      if (this.opts.baselinePath) {
        try {
          const shot = await page.screenshot({ fullPage: true });
          const baseBuf = await readFile(this.opts.baselinePath);
          const { PNG } = await loadOptional("pngjs") as PngModule;
          const pixelmatchModule = await loadOptional("pixelmatch") as { default: Pixelmatch };
          const pixelmatch = pixelmatchModule.default;
          const base = PNG.sync.read(baseBuf);
          const cur = PNG.sync.read(shot);
          if (base.width === cur.width && base.height === cur.height) {
            const diffPixels = pixelmatch(
              base.data,
              cur.data,
              null,
              base.width,
              base.height,
              { threshold: 0.1 },
            );
            visualDiff = { diffPixels, totalPixels: base.width * base.height };
          }
        } catch (error) {
          void error;
        }
      }

      return visualDiff
        ? { axeViolations, perfMetrics, visualDiff, baselineChanged: this.opts.baselineChanged }
        : { axeViolations, perfMetrics };
    } finally {
      await browser.close().catch((error: unknown) => {
        console.warn("设计分层探测浏览器关闭失败", { target, error });
      });
    }
  }
}

/**
 * 借助已注入的 AgentRunner 收集页面分层信号，作为本地 Playwright 探测器的可替代实现。
 * URL 目标直接交给浏览器工具；内联 HTML 会先写入临时文件，再以 file URL 交给工具打开。
 * Agent 输出仍须经过严格 JSON 提取与字段归一化，不能把后端返回的任意文本直接当成探测结果。
 */
export class AgentTierProbe implements TierSignalProbe {
  constructor(private runner: AgentRunner) {}

  async probe(target: ProbeTarget): Promise<RawTierSignals> {
    let where: string;
    if (target.url) {
      where = target.url;
    } else if (target.html) {
      const dir = join(tmpdir(), "kunpeng-probe");
      await mkdir(dir, { recursive: true });
      const htmlPath = join(dir, `kunpeng-probe-${process.pid}.html`);
      await writeFile(htmlPath, target.html);
      where = `file://${htmlPath}`;
    } else {
      throw new Error("ProbeTarget 需 html 或 url 之一");
    }

    const out = await this.runner.run({
      stage: "spec",
      system: "",
      input:
        `用你可用的浏览器工具（chrome-devtools MCP 的 lighthouse_audit / 可达性审计之一）打开 ${where}，` +
        `等待页面渲染完成后只返回严格单行 JSON，不要解释，不要 markdown 包裹。` +
        `JSON 必须匹配形状 {"axeViolations":[{"id":"...","impact":"..."}],` +
        `"perfMetrics":{"lcpMs":0,"cls":0,"tbtMs":0,"totalBytes":0}}。`,
      tools: ["browser"],
    });

    const text =
      typeof out === "string"
        ? out
        : out.text;
    let json: string;
    try {
      json = extractFirstJsonObject(text);
    } catch {
      throw new Error("AgentTierProbe: 无法从 agent 输出解析信号");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      throw new Error("AgentTierProbe: 无法从 agent 输出解析信号");
    }
    const parsedRecord = isRecord(parsed) ? parsed : {};
    const perfRecord = isRecord(parsedRecord.perfMetrics) ? parsedRecord.perfMetrics : {};

    return {
      axeViolations: axeViolationsFrom(parsedRecord.axeViolations),
      perfMetrics: {
        lcpMs: numberFrom(perfRecord.lcpMs),
        cls: numberFrom(perfRecord.cls),
        tbtMs: numberFrom(perfRecord.tbtMs),
        totalBytes: numberFrom(perfRecord.totalBytes),
      },
    };
  }
}

export function pickProbe(
  opts: { kind?: string; runner?: AgentRunner; playwright?: PlaywrightProbeOptions } = {},
): TierSignalProbe {
  const kind = (opts.kind ?? process.env.KUNPENG_PROBE ?? "playwright").toLowerCase();
  if (kind === "fake") return new FakeTierProbe();
  if (kind === "agent" && opts.runner) return new AgentTierProbe(opts.runner);
  return new PlaywrightTierProbe(opts.playwright);
}
