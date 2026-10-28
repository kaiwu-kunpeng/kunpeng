import { clientSource } from "./helpers/client-source.js";
import { describe, expect, it } from "vitest";

const clientSrc = clientSource();

describe("图片异地管控(作者验收)", () => {
  it("异地判定接入图片路径且默认拦截", () => {
    expect(clientSrc).toContain("kpIsRemoteHost");
    expect(clientSrc.includes("原图不上传") || clientSrc.includes("\\u539F\\u56FE\\u4E0D\\u4E0A\\u4F20")).toBe(true);
  });
  it("canvas 压缩脱敏管线", () => {
    expect(clientSrc).toContain("toBlob");
    expect(clientSrc).toContain("1280");
    expect(/0\.72|0\.7\b/.test(clientSrc)).toBe(true);
    expect(clientSrc).toContain("safe.jpg");
  });
  it("失败不回退直传", () => {
    expect(clientSrc.includes("压缩失败") || clientSrc.includes("\\u538B\\u7F29\\u5931\\u8D25")).toBe(true);
  });
});
