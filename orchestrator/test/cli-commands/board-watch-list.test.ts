import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import "../../src/cli-commands/board-serve.js";
import { dispatchCliCommand, type CliContext } from "../../src/cli-commands/registry.js";
import { readWatchList } from "../../src/board/watch.js";

let state: string;
let prevState: string | undefined;

beforeEach(() => {
  state = mkdtempSync(join(tmpdir(), "kp-bwl-state-"));
  prevState = process.env.KUNPENG_STATE;
  process.env.KUNPENG_STATE = state;
});

afterEach(() => {
  if (prevState === undefined) delete process.env.KUNPENG_STATE;
  else process.env.KUNPENG_STATE = prevState;
});

function ctx(rest: string[]): CliContext {
  return { repoRoot: state, kunpengHome: state, rest, argv: rest, flags: new Set<string>() };
}

describe("board-watch --list 不再被当路径入库", () => {
  it("--list 走列表分支:watch 列表保持空,无 --list 伪条目", async () => {
    expect(await dispatchCliCommand("board-watch", ctx(["--list"]))).toBe(true);
    const list = await readWatchList(state);
    expect(list).toEqual([]);
  });

  it("真实路径照常入库;无参走列表分支不写入", async () => {
    const proj = mkdtempSync(join(tmpdir(), "kp-bwl-proj-"));
    await dispatchCliCommand("board-watch", ctx([proj]));
    expect(await readWatchList(state)).toContain(proj);
    const state2 = mkdtempSync(join(tmpdir(), "kp-bwl-state2-"));
    process.env.KUNPENG_STATE = state2;
    await dispatchCliCommand("board-watch", ctx([]));
    expect(await readWatchList(state2)).toEqual([]);
  });
});