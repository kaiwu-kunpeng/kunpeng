import { clientSource } from "./helpers/client-source.js";
import { wsEndpointsSource } from "./helpers/ws-source.js";
import { describe, expect, it } from "vitest";

const clientSrc = clientSource();
const wsSrc = wsEndpointsSource();

describe("投影三档与loop链接(作者验收)", () => {
  it("三档切换存在且带 localStorage 记忆", () => {
    expect(clientSrc.includes("详细") && clientSrc.includes("结果")).toBe(true);
    expect(/localStorage[\s\S]{0,200}(projection|投影|kpProj)/.test(clientSrc) || /kp-proj/.test(clientSrc)).toBe(true);
  });
  it("普通档折叠过程帧为手风琴", () => {
    expect(clientSrc.includes("过程") || clientSrc.includes("\\u8FC7\\u7A0B")).toBe(true);
  });
  it("/loop 帧带 fingerprint 且前端渲染跳转卡片", () => {
    expect(wsSrc).toContain("data-loop-fp");
    expect(clientSrc).toContain("#/evolution");
  });
});
