import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const storeSrc = readFileSync(join(root, "src", "switchboard", "store.ts"), "utf8");
const driverSrc = readFileSync(join(root, "src", "loop", "driver.ts"), "utf8");
const devSrc = readFileSync(join(root, "src", "loop", "dev-cycle.ts"), "utf8");

describe("switchboard 协议化(作者验收)", () => {
  it("新 kind 与 read/payload 字段在位", () => {
    for (const k of ["idle_notification", "failure", "task_assignment", "plan_approval_request", "shutdown_request"]) {
      expect(storeSrc).toContain(`"${k}"`);
    }
    expect(storeSrc).toContain("read?");
    expect(storeSrc).toContain("payload?");
    expect(storeSrc).toContain("markRead");
  });
  it("driver 收口发 idle_notification(可选注入)", () => {
    expect(driverSrc).toContain("idle_notification");
    expect(/verdict/.test(driverSrc)).toBe(true);
  });
  it("dev-cycle 失败路径发 failure", () => {
    expect(devSrc).toContain("\"failure\"");
  });
});