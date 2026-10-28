import { clientSource } from "./helpers/client-source.js";
import { httpSource } from "./helpers/http-source.js";
import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const httpSrc = httpSource();
const clientSrc = clientSource();

describe("OCR 默认档(作者验收)", () => {
  it("vendored 资产在库且白名单五条齐", () => {
    for (const f of ["tesseract.min.js", "worker.min.js", "tesseract-core-simd-lstm.wasm.js", "chi_sim.traineddata.gz", "eng.traineddata.gz"]) {
      expect(existsSync(join(root, "assets", "vendor", "tesseract", f))).toBe(true);
      expect(httpSrc).toContain("tesseract/" + f);
    }
  });
  it("client 走自托管路径且带可编辑预览", () => {
    expect(clientSrc).toContain("createWorker");
    expect(clientSrc).toContain("/vendor/tesseract");
    expect(clientSrc).toContain("chi_sim");
    expect(clientSrc.includes("抽文字") || clientSrc.includes("\\u62BD\\u6587\\u5B57")).toBe(true);
    expect(clientSrc).toContain("ocr.txt");
  });
  it("识别失败与原图不出机话术", () => {
    expect(clientSrc.includes("未识别到文字") || clientSrc.includes("\\u672A\\u8BC6\\u522B\\u5230\\u6587\\u5B57")).toBe(true);
    expect(clientSrc.includes("原图未离开本机") || clientSrc.includes("\\u539F\\u56FE\\u672A\\u79BB\\u5F00\\u672C\\u673A")).toBe(true);
  });
});
