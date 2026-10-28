import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { readProductSessionViewForSlug } from "../../src/server/state.js";

async function tmp(): Promise<string> { return mkdtemp(join(tmpdir(), "kp-psfs-")); }

describe("readProductSessionViewForSlug", () => {
  it("按 slug 加载该产品 loop（不依赖 interview.json）", async () => {
    const root = await tmp();
    const dir = join(root, ".kunpeng", "product", "my-slug");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "state.json"), JSON.stringify({ slug: "my-slug", currentStage: "design", stages: {} }), "utf8");
    const view = await readProductSessionViewForSlug(root, "my-slug");
    expect(view).toBeTruthy();
    expect(view?.status).toBe("done");
    expect(view?.idea).toBe("my-slug");
    expect(view?.loop?.currentStage).toBe("design");
    await rm(root, { recursive: true, force: true });
  });

  it("无该产品 loop → undefined", async () => {
    const root = await tmp();
    expect(await readProductSessionViewForSlug(root, "missing")).toBeUndefined();
    await rm(root, { recursive: true, force: true });
  });
});