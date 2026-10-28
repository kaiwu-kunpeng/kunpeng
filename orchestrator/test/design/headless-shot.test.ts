import { expect, test } from "vitest";
import { captureScreenshot, chromeShotArgs, findChrome } from "../../src/design/headless-shot.js";

test("chromeShotArgs builds headless screenshot args", () => {
  const args = chromeShotArgs("file:///x.html", "/tmp/o.png", 375, 667);

  expect(args).toContain("--headless");
  expect(args).toContain("--screenshot=/tmp/o.png");
  expect(args).toContain("--window-size=375,667");
  expect(args.at(-1)).toBe("file:///x.html");
});

test("findChrome returns undefined when no candidate exists", () => {
  expect(findChrome(["/no/a", "/no/b"], undefined, () => false)).toBeUndefined();
});

test("findChrome returns the first existing candidate", () => {
  expect(findChrome(["/no/a", "/yes"], undefined, (path) => path === "/yes")).toBe("/yes");
});

test("findChrome prefers an existing env path", () => {
  expect(findChrome([], "/envc", (path) => path === "/envc")).toBe("/envc");
});

test("captureScreenshot returns false without a chrome binary", async () => {
  await expect(captureScreenshot({ url: "file:///x", out: "/tmp/none.png" }, undefined)).resolves.toBe(
    false,
  );
});
