import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { FakeCapturer } from "../src/design/screenshot.js";

// AC2/AC3：FakeCapturer 自动建多层父目录、写入非空占位内容（含 HTML 长度），且无浏览器依赖。
test("FakeCapturer.capture：自动建嵌套目录并写入含 HTML 长度的占位内容", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kp-screenshot-"));
  const out = join(dir, "a", "b", "c", "shot.png");
  const html = "<html>hi</html>";

  await new FakeCapturer().capture(html, out);

  const written = await readFile(out, "utf8");
  expect(written.length > 0).toBe(true);
  expect(written).toContain(String(html.length));
});
