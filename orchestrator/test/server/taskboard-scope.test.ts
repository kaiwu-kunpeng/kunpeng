import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "server", "routes", "taskboard.ts"),
  "utf8",
);

describe("taskboard 租户隔离", () => {
  it("boardFor 按 profile 分目录", () => {
    expect(src).toMatch(/currentProfileId/);
    expect(src).toMatch(/taskboard"?,\s*currentProfileId\(\)\s*\?\?\s*"home"/);
  });
  it("create 透传 projectId,list 支持过滤", () => {
    expect(src).toMatch(/projectId/);
    expect(src).toMatch(/searchParams|projectId=/);
  });
});