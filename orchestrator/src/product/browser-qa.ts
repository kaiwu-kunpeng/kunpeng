import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTask } from "../task/store.js";
import { productLoopDir } from "./loop-store.js";
import { executeQaScript, readQaScript, type QaPageLike, type QaScriptStep } from "./qa-script.js";

export interface QaVerdictInput {
  status?: number;
  bodyTextLength: number;
  interactiveCount?: number;
  pageErrors?: string[];
  consoleErrors: string[];
  networkFailures?: string[];
  loadMs?: number;
  loadBudgetMs?: number;
  scriptFailures?: string[];
  seoHints?: string[];
}

export interface QaVerdict {
  ok: boolean;
  problems: string[];
}

export type QaRunner = (
  url: string,
  outDir: string,
  steps?: QaScriptStep[],
) => Promise<{ verdictInput: QaVerdictInput; screenshotPath?: string }>;

export function seoHintsFrom(page: {
  title?: string;
  metaDescription?: string;
  h1Count: number;
  ogTitle?: boolean;
  canonical?: boolean;
  jsonLd?: boolean;
}): string[] {
  const hints: string[] = [];
  const title = page.title?.trim();
  if (!title) {
    hints.push("缺 <title>");
    hints.push("缺 title 文本");
  } else if (title.length > 60) {
    hints.push("title 过长");
  }
  if (!page.metaDescription?.trim()) hints.push("缺 meta description");
  if (page.h1Count === 0) hints.push("缺 H1");
  if (!page.ogTitle) hints.push("缺 og:title");
  if (!page.canonical) hints.push("缺 canonical");
  if (!page.jsonLd) hints.push("缺结构化数据 JSON-LD");
  return hints;
}

export function qaVerdict(input: QaVerdictInput): QaVerdict {
  const problems: string[] = [];
  if (input.status !== undefined && (input.status < 200 || input.status >= 300)) {
    problems.push(`HTTP 状态码异常: ${input.status}`);
  }
  const interactiveCount = input.interactiveCount ?? 0;
  if (input.bodyTextLength < 20 && interactiveCount === 0) {
    problems.push(`页面空白: body 文本长度 ${input.bodyTextLength}，交互元素 ${interactiveCount}`);
  }
  for (const err of input.pageErrors ?? []) problems.push(`页面错误: ${err}`);
  for (const err of input.consoleErrors) problems.push(`控制台: ${err}`);
  for (const failure of input.networkFailures ?? []) problems.push(`网络: ${failure}`);
  for (const failure of input.scriptFailures ?? []) problems.push(`脚本: ${failure}`);
  if (input.loadMs !== undefined && input.loadMs > (input.loadBudgetMs ?? 10_000)) {
    problems.push(`加载超时: ${input.loadMs}ms`);
  }
  return { ok: problems.length === 0, problems };
}

function truncateUrl(url: string): string {
  return url.length > 120 ? url.slice(0, 120) : url;
}

export const playwrightQaRunner: QaRunner = async (url, outDir, steps = []) => {
  const { chromium } = await import("playwright");
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const networkFailures: string[] = [];
  const scriptFailures: string[] = [];
  let omittedNetworkFailures = 0;
  const addNetworkFailure = (failure: string) => {
    if (networkFailures.length < 20) {
      networkFailures.push(failure);
      return;
    }
    omittedNetworkFailures += 1;
  };
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(10_000);
    page.setDefaultNavigationTimeout(10_000);
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("requestfailed", (request) => {
      addNetworkFailure(
        `${request.method()} ${truncateUrl(request.url())} → failed: ${request.failure()?.errorText ?? "unknown"}`,
      );
    });
    page.on("response", (response) => {
      if (response.status() >= 400) {
        addNetworkFailure(`${response.request().method()} ${truncateUrl(response.url())} → ${response.status()}`);
      }
    });

    const loadStartedAt = Date.now();
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 10_000 });
    const loadMs = Date.now() - loadStartedAt;
    const bodyTextLength = await page.evaluate(() => document.body?.innerText.length ?? 0);
    const interactiveCount = await page.evaluate(
      () => document.querySelectorAll("input,button,a,select,textarea").length,
    );
    const screenshotPath = join(outDir, "preview.png");
    await page.screenshot({ path: screenshotPath, fullPage: true });
    const seoFacts = await page.evaluate(() => ({
      title: document.title,
      metaDescription: document.querySelector('meta[name="description"]')?.getAttribute("content") ?? undefined,
      h1Count: document.querySelectorAll("h1").length,
      ogTitle: Boolean(document.querySelector('meta[property="og:title"]')?.getAttribute("content")),
      canonical: Boolean(document.querySelector('link[rel~="canonical"]')?.getAttribute("href")),
      jsonLd: Boolean(document.querySelector('script[type="application/ld+json"]')),
    }));
    const seoHints = seoHintsFrom(seoFacts);
    if (steps.length > 0) {
      const scriptPage: QaPageLike = {
        goto: async (pageUrl) => page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 10_000 }),
        click: async (selector) => page.click(selector),
        fill: async (selector, value) => page.fill(selector, value),
        bodyText: async () => page.evaluate(() => document.body?.innerText ?? ""),
        count: async (selector) => page.evaluate((s) => document.querySelectorAll(s).length, selector),
      };
      const scriptResults = await executeQaScript(scriptPage, url, steps);
      scriptFailures.push(
        ...scriptResults.flatMap((result, index) => (result.ok ? [] : [`步骤${index + 1} ${result.error ?? "未知错误"}`])),
      );
    }
    const verdictNetworkFailures =
      omittedNetworkFailures > 0
        ? [...networkFailures, `...另有 ${omittedNetworkFailures} 条省略`]
        : networkFailures;

    return {
      verdictInput: {
        status: response?.status(),
        bodyTextLength,
        interactiveCount,
        pageErrors,
        consoleErrors,
        networkFailures: verdictNetworkFailures,
        loadMs,
        seoHints,
        ...(scriptFailures.length > 0 ? { scriptFailures } : {}),
      },
      screenshotPath,
    };
  } finally {
    await browser.close().catch((error: unknown) => {
      console.warn("产品浏览器质检关闭失败", { url, error });
    });
  }
};

/**
 * 对产品预览执行一次完整 QA，并把可复用的判定结果与截图位置写入产品循环目录。
 * 调用方可以注入 runner 以复用同一套编排逻辑；未注入时使用上方的 Playwright 实现。
 * QA 不通过时创建确定性的修复任务，重复执行遇到同一任务标识会继续复用，而不会把重复任务当作新故障。
 * 无论是否需要修复任务，最终都会更新 qa.json，供后续 dossier、看板和自动化阶段读取同一份事实。
 * 返回值保留原始 verdict，并仅在实际存在时附带 taskId、screenshotPath 与 seoHints。
 */
export async function qaWithFixTask(
  repoRoot: string,
  slug: string,
  url: string,
  now: number,
  deps: { runQa?: QaRunner } = {},
): Promise<QaVerdict & { taskId?: string; screenshotPath?: string; seoHints?: string[] }> {
  const outDir = productLoopDir(repoRoot, slug);
  await mkdir(outDir, { recursive: true });
  const scriptSteps = await readQaScript(repoRoot, slug);
  const qa = await (deps.runQa ?? playwrightQaRunner)(url, outDir, scriptSteps);
  const verdict = qaVerdict(qa.verdictInput);
  const taskId = `task-${now}-qa-${slug}`;

  if (!verdict.ok) {
    const at = new Date(now).toISOString();
    try {
      await createTask(repoRoot, {
        id: taskId,
        type: "fix",
        title: `${slug} 预览异常`,
        goal: verdict.problems.join("\n"),
        acceptanceCriteria: [
          "浏览器 QA 通过：页面非空白且无控制台错误",
          ...(scriptSteps.length > 0 ? ["QA 脚本全部步骤通过"] : []),
        ],
        projectId: slug,
        status: "ready",
        createdAt: at,
        updatedAt: at,
      });
    } catch (error) {
      if (!String((error as Error).message ?? error).includes(`task already exists: ${taskId}`)) {
        throw error;
      }
    }
  }

  await writeFile(
    join(outDir, "qa.json"),
    `${JSON.stringify({ ok: verdict.ok, problems: verdict.problems, seoHints: qa.verdictInput.seoHints ?? [], at: now, screenshotPath: qa.screenshotPath }, null, 2)}\n`,
    "utf8",
  );

  return {
    ...verdict,
    ...(qa.verdictInput.seoHints ? { seoHints: qa.verdictInput.seoHints } : {}),
    ...(verdict.ok ? {} : { taskId }),
    ...(qa.screenshotPath ? { screenshotPath: qa.screenshotPath } : {}),
  };
}
