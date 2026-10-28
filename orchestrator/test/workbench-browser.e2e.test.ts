import { describe, expect, test } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import type { DashboardState } from "../src/server/state.js";
import { themeCss } from "../src/server/ui/theme.js";
import { clientScript } from "../src/server/ui/client.js";
import { renderWorkbench } from "../src/server/ui/views/workbench.js";
import { createBrowserHarness, endSse, writeSse } from "./e2e/browser-harness.js";

function state(): DashboardState & { projects: Array<{ id: string; name: string }> } {
  return {
    agents: 0,
    flows: [],
    running: [],
    blockers: [],
    humanGates: [],
    artifacts: {},
    branches: [],
    statusCounts: {},
    systemLight: "green",
    agentAssignments: [],
    patrol: { pendingCount: 0, lastRunText: "尚未巡检" },
    plans: [],
    code: {
      srcLines: 0,
      testLines: 0,
      passedLines: 0,
      inFlightLines: 0,
      completed: 0,
      running: 0,
      rolledBack: 0,
    },
    designCandidates: [],
    health: { alerts: [], running: 0, healthy: 0 },
    projects: [{ id: "current", name: "当前项目" }],
  };
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function pageHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <style>${themeCss}</style>
</head>
<body>
  <div id="view"></div>
  <script>${clientScript}</script>
</body>
</html>`;
}

describe.skipIf(!process.env.KP_E2E)("workbench true browser e2e", () => {
  test("Playwright 真浏览器点击任务窗口,接收 SSE token/gate,并提交 gate 答复", async () => {
    const seen: { message?: string; gate?: unknown } = {};
    const harness = await createBrowserHarness(async (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");

      if (req.method === "GET" && url.pathname === "/") {
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.end(pageHtml());
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/state") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ projects: [{ id: "current", name: "当前项目" }] }));
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/view") {
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.end(renderWorkbench(state()));
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/workspace/current/events") {
        seen.message = url.searchParams.get("msg") ?? "";
        res.setHeader("content-type", "text/event-stream");
        res.setHeader("cache-control", "no-cache");
        res.setHeader("connection", "keep-alive");
        writeSse(res, `<span class="kp-ev-token">真浏览器 token 到达</span>`);
        await delay(10);
        writeSse(res, `<div class="kp-ev kp-ev-gate" data-gate="g1"><button data-gate-yes="g1">是</button><button data-gate-no="g1">否</button></div>`);
        await delay(10);
        writeSse(res, `<div class="kp-ev kp-ev-usage">in 2 / out 3 · fake</div>`);
        endSse(res);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/workspace/current/gate") {
        seen.gate = JSON.parse(await readBody(req));
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      res.statusCode = 404;
      res.end("not found");
    });

    try {
      await harness.page.goto(`${harness.baseUrl}/#/workbench`);
      await harness.page.getByRole("button", { name: "＋ 新任务" }).click();
      await harness.page.locator('.kp-win[data-kind="task"] .kp-win-input').fill("证明工作台 e2e");
      await harness.page.locator('.kp-win[data-kind="task"] .kp-win-send').click();

      await expect.poll(async () => harness.page.locator(".kp-ev-token").filter({ hasText: "真浏览器 token 到达" }).count()).toBe(1);
      await expect.poll(async () => harness.page.locator(".kp-ev-usage").filter({ hasText: "in 2 / out 3" }).count()).toBe(1);
      expect(seen.message).toBe("证明工作台 e2e");

      await harness.page.locator('[data-gate-yes="g1"]').click();
      await expect.poll(() => seen.gate).toEqual({ gateId: "g1", decision: "yes" });
    } finally {
      await harness.close();
    }
  });
});
