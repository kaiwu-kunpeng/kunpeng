import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { cliSource } from "../helpers/cli-source.js";

const src = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");
const devCycle = readFileSync(join(src, "loop", "dev-cycle.ts"), "utf8");
const cli = cliSource();

describe("O3 孤儿接线", () => {
  it("dev-cycle 失败 blocker 走 formatVerifyBlocker,不再裸截 200 字", () => {
    expect(devCycle).toContain("formatVerifyBlocker(verify)");
    expect(devCycle).toContain('from "./verify-blocker.js"');
    expect(devCycle).not.toContain("verify.output.slice(0, 200)");
  });

  it("cli patrol 接线 candidate-sandbox 差分评测", () => {
    expect(cli).toContain("buildCandidateSandbox");
    expect(cli).toContain("applyConventions");
    expect(cli).toContain('conventionsRelPath: "AGENTS.md"');
    expect(cli).toContain("listHoldout: () => regressionStore.list(\"holdout\")");
    expect(cli).toMatch(/runPatrol\(\{[^}]*curveDeps/s);
  });
});
