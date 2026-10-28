import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readInterview, writeInterview, activateProduct, readInterviewFor } from "../../src/product/store.js";
import { startInterview } from "../../src/product/interview.js";
import { productSlug } from "../../src/product/artifacts.js";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "kp-iso-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe("per-slug 访谈隔离", () => {
  it("两个产品各存各的访谈，互不覆盖", async () => {
    await writeInterview(root, startInterview("产品甲"));
    await writeInterview(root, startInterview("产品乙"));
    expect((await readInterview(root))?.idea).toBe("产品乙");
    expect((await readInterviewFor(root, productSlug("产品甲")))?.idea).toBe("产品甲");
    expect((await readInterviewFor(root, productSlug("产品乙")))?.idea).toBe("产品乙");
  });
  it("activateProduct 切回旧产品", async () => {
    await writeInterview(root, startInterview("产品甲"));
    await writeInterview(root, startInterview("产品乙"));
    expect(await activateProduct(root, productSlug("产品甲"))).toBe(true);
    expect((await readInterview(root))?.idea).toBe("产品甲");
  });
  it("activate 不存在的产品返回 false 且指针不动", async () => {
    await writeInterview(root, startInterview("产品甲"));
    expect(await activateProduct(root, "不存在")).toBe(false);
    expect((await readInterview(root))?.idea).toBe("产品甲");
  });
  it("无指针时回退读旧全局槽（历史兼容）", async () => {
    const dir = join(root, ".kunpeng", "product");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "interview.json"), JSON.stringify(startInterview("老产品")));
    expect((await readInterview(root))?.idea).toBe("老产品");
  });
});