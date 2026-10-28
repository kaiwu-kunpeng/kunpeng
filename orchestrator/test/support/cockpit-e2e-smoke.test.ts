import { describe, expect, it } from "vitest";
import { withCockpit } from "./cockpit-e2e.js";

describe("withCockpit", () => {
  it("起真 serve(无鉴权)根路径可达", async () => {
    await withCockpit(process.cwd(), async ({ baseUrl }) => {
      const res = await fetch(baseUrl + "/");
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("鲲鹏");
    });
  }, 30000);
});
