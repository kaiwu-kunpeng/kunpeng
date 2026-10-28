import { describe, it, expect, vi } from "vitest";
import { runAiRepoKit } from "../../src/dossier/ai-repo-kit-cmd.js";
import { runSpecDelta } from "../../src/spec/spec-delta-cmd.js";
import { runBurnForecast } from "../../src/metrics/burn-forecast-cmd.js";

describe("runAiRepoKit", () => {
  it("把四件套写到 outDir 并返回 0", async () => {
    const written: string[] = [];
    const io = {
      mkdir: vi.fn(async () => undefined),
      writeFile: vi.fn(async (p: string) => {
        written.push(p);
      }),
    };
    const code = await runAiRepoKit({ projectName: "demo" }, "/out", io);
    expect(code).toBe(0);
    expect(written.some((p) => p.endsWith("AGENTS.md"))).toBe(true);
    expect(written.some((p) => p.endsWith("skills/README.md"))).toBe(true);
    expect(io.mkdir).toHaveBeenCalled();
    expect(written).toHaveLength(4);
  });
});

describe("runSpecDelta", () => {
  it("读两版并打印增量,返回 0", () => {
    const files: Record<string, string> = {
      "/base.md": "THE SYSTEM SHALL a.\nTHE SYSTEM SHALL b.\n",
      "/next.md": "THE SYSTEM SHALL a.\nTHE SYSTEM SHALL c.\n",
    };
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const code = runSpecDelta("/base.md", "/next.md", { readFile: (p) => files[p] });
    expect(code).toBe(0);
    const out = log.mock.calls.map((c) => String(c[0])).join("\n");
    expect(out).toContain("+1");
    expect(out).toContain("-1");
    log.mockRestore();
  });
});

describe("runBurnForecast", () => {
  it("打印速率/剩余/耗尽时点,返回 0", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const code = runBurnForecast(20, 100, 2);
    expect(code).toBe(0);
    const out = log.mock.calls.map((c) => String(c[0])).join("\n");
    expect(out).toMatch(/10/); // rate $10/h
    log.mockRestore();
  });
});