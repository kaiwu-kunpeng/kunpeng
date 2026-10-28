import { expect, test } from "vitest";
import { spawnStream } from "../src/agent/cli-stream.js";

test("cli-stream-idle: silent child is killed after idle timeout", async () => {
  const lines: string[] = [];

  const res = await spawnStream(
    process.execPath,
    ["-e", "setInterval(() => {}, 1000)"],
    process.cwd(),
    (line) => lines.push(line),
    { idleTimeoutMs: 50, timeoutMs: 2_000 },
  );

  expect(lines).toEqual([]);
  expect(res.exitCode).toBe(124);
});

test("cli-stream-idle: output activity refreshes idle timeout", async () => {
  const lines: string[] = [];

  const res = await spawnStream(
    process.execPath,
    ["-e", "let i = 0; const t = setInterval(() => { console.log(++i); if (i === 3) clearInterval(t); }, 20);"],
    process.cwd(),
    (line) => lines.push(line),
    { idleTimeoutMs: 100, timeoutMs: 2_000 },
  );

  expect(lines).toEqual(["1", "2", "3"]);
  expect(res.exitCode).toBe(0);
});
