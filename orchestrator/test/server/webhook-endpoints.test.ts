import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { handleWebhookHttpRoute } from "../../src/server/webhook-endpoints.js";

const httpTs = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "server", "http.ts"),
  "utf8",
);

describe("webhook 层析出", () => {
  it("http.ts 不再内联三条 webhook 判据", () => {
    expect(httpTs).not.toContain('path === "/tg/webhook"');
    expect(httpTs).not.toContain('path === "/api/dispatch"');
    expect(httpTs).not.toContain('path === "/api/drain"');
    expect(httpTs).toContain("handleWebhookHttpRoute");
  });

  it("非 webhook 路径落空返回 false,不写响应", async () => {
    let ended = false;
    const res = { end: () => { ended = true; }, setHeader: () => {}, statusCode: 200 };
    const handled = await handleWebhookHttpRoute(
      "GET",
      "/api/state",
      "/api/state",
      { headers: {} } as never,
      res as never,
      { stateDir: "/nonexistent-kp-webhook-x", remoteIsLoopback: true },
    );
    expect(handled).toBe(false);
    expect(ended).toBe(false);
  });
});