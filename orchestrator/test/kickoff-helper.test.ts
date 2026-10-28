import { expect, test } from "vitest";
import { KICKOFF_KIND, isKickoffMessage, formatKickoffBody } from "../src/switchboard/kickoff.js";

test("kind=kickoff 直接判真", () => {
  expect(isKickoffMessage({ kind: KICKOFF_KIND })).toBe(true);
});

test("body 命中开工关键词判真，普通消息判假", () => {
  expect(isKickoffMessage({ body: "【loop-x·开工预告】要动 http.ts" })).toBe(true);
  expect(isKickoffMessage({ body: "我正在改 client.ts" })).toBe(true);
  expect(isKickoffMessage({ body: "working on the parser" })).toBe(true);
  expect(isKickoffMessage({ body: "今天进度汇报:已合 main" })).toBe(false);
  expect(isKickoffMessage({})).toBe(false);
});

test("formatKickoffBody 结构化且能被自身判为开工消息", () => {
  const body = formatKickoffBody({ instance: "self-evo", files: ["src/a.ts", "src/b.ts"], what: "接端点" });
  expect(body).toContain("self-evo");
  expect(body).toContain("开工预告");
  expect(body).toContain("接端点");
  expect(body).toContain("src/a.ts");
  expect(body).toContain("src/b.ts");
  expect(isKickoffMessage({ body })).toBe(true);
});

test("files 为空时有占位、仍是合法开工正文", () => {
  const body = formatKickoffBody({ instance: "x", files: [], what: "调研" });
  expect(body).toContain("(未指定)");
  expect(isKickoffMessage({ body })).toBe(true);
});