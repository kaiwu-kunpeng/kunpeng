import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { readProductSessionViewForSlug } from "../../src/server/state.js";

async function tmp(): Promise<string> { return mkdtemp(join(tmpdir(), "kp-pssd-")); }

describe("readProductSessionViewForSlug 带 definition（修空态 bug）", () => {
  it("非 interview 产品也带非空 definition（使工位可渲染）", async () => {
    const root = await tmp();
    const dir = join(root, ".kunpeng", "product", "ref-prod");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "state.json"), JSON.stringify({ slug: "ref-prod", currentStage: "spec", stages: {} }), "utf8");
    const view = await readProductSessionViewForSlug(root, "ref-prod");
    expect(view).toBeTruthy();
    expect(view?.definition).toBeTruthy();
    expect(view?.loop?.currentStage).toBe("spec");
    await rm(root, { recursive: true, force: true });
  });

  it("slug 命中单例 interview → 复用完整视图(含原 definition)", async () => {
    const root = await tmp();
    // 写单例 interview（idea=研发指挥仪表盘 → slug 同名），含 definition
    const pdir = join(root, ".kunpeng", "product");
    await mkdir(join(pdir, "研发指挥仪表盘"), { recursive: true });
    await writeFile(join(pdir, "interview.json"), JSON.stringify({
      idea: "研发指挥仪表盘", status: "done", answers: ["a"],
      definition: { problem: "真问题", users: ["u"], stories: ["s"], acceptance: ["ac"] },
    }), "utf8");
    await writeFile(join(pdir, "研发指挥仪表盘", "state.json"), JSON.stringify({ slug: "研发指挥仪表盘", currentStage: "design", stages: {} }), "utf8");
    const view = await readProductSessionViewForSlug(root, "研发指挥仪表盘");
    expect(view?.definition?.problem).toBe("真问题");
    await rm(root, { recursive: true, force: true });
  });

  it("无 loop → undefined", async () => {
    const root = await tmp();
    expect(await readProductSessionViewForSlug(root, "nope")).toBeUndefined();
    await rm(root, { recursive: true, force: true });
  });
});