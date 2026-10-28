import { expect, test } from "vitest";
import { spawnStream } from "../src/agent/cli-stream.js";

test("spawnStream 按行增量回调且返回完整 stdout 与退出码", async () => {
  const lines: string[] = [];
  const res = await spawnStream(
    "sh", ["-c", "printf 'a\\nb\\nc\\n'"], process.cwd(),
    (l) => lines.push(l),
  );
  expect(lines).toEqual(["a", "b", "c"]);
  expect(res.stdout).toBe("a\nb\nc\n");
  expect(res.exitCode).toBe(0);
});

test("spawnStream 回调残留尾段(无行尾)", async () => {
  const lines: string[] = [];
  const res = await spawnStream(
    "sh", ["-c", "printf 'x\\ny'"], process.cwd(),
    (l) => lines.push(l),
  );
  expect(lines).toEqual(["x", "y"]);
  expect(res.exitCode).toBe(0);
});
