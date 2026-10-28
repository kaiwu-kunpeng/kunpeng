import { clientSource } from "./helpers/client-source.js";
import { describe, expect, it } from "vitest";

const clientSrc = clientSource();

describe("压缩包递归抽取(作者验收)", () => {
  it("递归抽取函数与段头格式在位", () => {
    expect(clientSrc).toContain("kpZipExtractAll");
    expect(clientSrc).toContain("===== ");
    expect(clientSrc).toContain("zip.txt");
  });
  it("嵌套限深与跳过话术", () => {
    expect(clientSrc.includes("嵌套过深") || clientSrc.includes("\\u5D4C\\u5957\\u8FC7\\u6DF1")).toBe(true);
    expect(clientSrc.includes("跳过") || clientSrc.includes("\\u8DF3\\u8FC7")).toBe(true);
  });
  it("不出机话术与空包提示", () => {
    expect(clientSrc.includes("原包未离开本机") || clientSrc.includes("\\u539F\\u5305\\u672A\\u79BB\\u5F00\\u672C\\u673A")).toBe(true);
    expect(clientSrc.includes("没有可抽取的文本") || clientSrc.includes("\\u6CA1\\u6709\\u53EF\\u62BD\\u53D6\\u7684\\u6587\\u672C")).toBe(true);
  });
});
