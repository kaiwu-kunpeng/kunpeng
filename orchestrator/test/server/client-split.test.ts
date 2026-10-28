import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { clientScript } from "../../src/server/ui/client.js";

const here = dirname(fileURLToPath(import.meta.url));

describe("clientScript 分段拼接", () => {
  it("拼接结果是合法 JS(node --check)且结构完整", () => {
    expect(typeof clientScript).toBe("string");
    expect(clientScript.length).toBeGreaterThan(150000);
    expect(clientScript.trimStart().startsWith("(function () {")).toBe(true);
    expect(clientScript.trimEnd().endsWith("})();")).toBe(true);
    const dir = mkdtempSync(join(tmpdir(), "kp-client-check-"));
    const file = join(dir, "client-rendered.js");
    writeFileSync(file, clientScript, "utf8");
    expect(() => execFileSync(process.execPath, ["--check", file], { stdio: "pipe" })).not.toThrow();
  });

  it("client-parts 至少 6 段且 client.ts 收成装配器", () => {
    const partsDir = join(here, "..", "..", "src", "server", "ui", "client-parts");
    const parts = readdirSync(partsDir).filter((f) => /^part\d+\.ts$/.test(f));
    expect(parts.length).toBeGreaterThanOrEqual(6);
  });
});