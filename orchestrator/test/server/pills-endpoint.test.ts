import { describe, it, expect } from "vitest";
import { withCockpit } from "../support/cockpit-e2e.js";

describe("GET /api/pills 极简计数端点(真 serve)", () => {
  it("返回 running/gates 两个数字,负载远小于 /api/state", async () => {
    await withCockpit(process.cwd(), async ({ baseUrl }) => {
      const r = await fetch(baseUrl + "/api/pills");
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type") || "").toContain("application/json");
      const body = await r.text();
      expect(body.length).toBeLessThan(200);
      const j = JSON.parse(body);
      expect(typeof j.running).toBe("number");
      expect(typeof j.gates).toBe("number");
    });
  }, 30000);
});