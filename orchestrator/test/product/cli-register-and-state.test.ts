import { mkdtemp, rm, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { runProductCommand } from "../../src/product/cli.js";
import { productSlug } from "../../src/product/artifacts.js";

const IDEA = "发票核对助手";
const NOW = 1_800_000_000_000;

const DEF = {
  idea: IDEA,
  problem: "财务每天手工核对 300 张发票，耗时 2 小时且易错",
  users: ["财务专员"],
  stories: ["当财务导入发票时，系统自动比对并标出差异"],
  acceptance: ["核对耗时降到 10 分钟以内"],
  jobStatement: "当我拿到一批发票时，我要快速找出差异",
  nonGoals: ["不做报税"],
};

/** 让 autoDefineProduct / 批判都拿到确定输出的假 runner。 */
const runner = {
  run: async (): Promise<{ text: string }> => ({ text: JSON.stringify(DEF) }),
};

function exists(p: string): Promise<boolean> {
  return access(p).then(() => true).catch(() => false);
}

describe("CLI 一句话建产品接通注册表与状态机", () => {
  it("返回 slug 且与 productSlug 一致", async () => {
    const repo = await mkdtemp(join(tmpdir(), "kp-cli-prod-"));
    const out = await runProductCommand({ repoRoot: repo, idea: IDEA, runner: runner as never, now: NOW });
    expect(out.slug).toBe(productSlug(IDEA));
    await rm(repo, { recursive: true, force: true });
  });

  it("产品进入 registry 的 index.json", async () => {
    const repo = await mkdtemp(join(tmpdir(), "kp-cli-prod-"));
    const out = await runProductCommand({ repoRoot: repo, idea: IDEA, runner: runner as never, now: NOW });
    const raw = await readFile(join(repo, ".kunpeng", "product", "index.json"), "utf8");
    expect(raw).toContain(out.slug);
    await rm(repo, { recursive: true, force: true });
  });

  it("建出 state.json", async () => {
    const repo = await mkdtemp(join(tmpdir(), "kp-cli-prod-"));
    const out = await runProductCommand({ repoRoot: repo, idea: IDEA, runner: runner as never, now: NOW });
    expect(await exists(join(repo, ".kunpeng", "product", out.slug, "state.json"))).toBe(true);
    await rm(repo, { recursive: true, force: true });
  });

  it("原有返回字段全部保留", async () => {
    const repo = await mkdtemp(join(tmpdir(), "kp-cli-prod-"));
    const out = await runProductCommand({ repoRoot: repo, idea: IDEA, runner: runner as never, now: NOW });
    expect(out.definition).toBeTruthy();
    expect(typeof out.draftSpecPath).toBe("string");
    expect(typeof out.gatePath).toBe("string");
    expect(out.gate).toBeTruthy();
    await rm(repo, { recursive: true, force: true });
  });
});