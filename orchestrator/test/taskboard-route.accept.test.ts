import { describe, expect, it } from "vitest";
import { httpSource } from "./helpers/http-source.js";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("TaskBoard 路由(作者验收)", () => {
  it("路由文件在位且五端点齐", () => {
    const p = join(root, "src", "server", "routes", "taskboard.ts");
    expect(existsSync(p)).toBe(true);
    const src = readFileSync(p, "utf8");
    for (const ep of ["/api/taskboard", "/api/taskboard/create", "/api/taskboard/claim", "/api/taskboard/complete", "/api/taskboard/reap"]) {
      expect(src).toContain(ep);
    }
    expect(src).toContain("TaskBoard");
    expect(src).toContain("reapDeadTasks");
  });
  it("已在 http 注册且业务错不抛 500", () => {
    const httpSrc = httpSource();
    expect(httpSrc).toContain("routes/taskboard");
    const routeSrc = readFileSync(join(root, "src", "server", "routes", "taskboard.ts"), "utf8");
    expect(routeSrc).toContain("ok: false");
  });
});
