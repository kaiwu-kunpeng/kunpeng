import { afterEach, beforeEach, expect, test } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InterviewSession } from "../src/product/contract.js";
import { readInterview, writeInterview } from "../src/product/store.js";

let repo: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "kp-product-interview-"));
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

const session: InterviewSession = {
  idea: "做个待办",
  status: "in-progress",
  step: 2,
  answers: ["管理任务", "个人用户"],
};

test("writeInterview then readInterview roundtrips the session", async () => {
  await writeInterview(repo, session);

  expect(await readInterview(repo)).toEqual(session);
});

test("writeInterview creates the product directory when absent", async () => {
  const productDir = join(repo, ".kunpeng", "product");
  expect(existsSync(productDir)).toBe(false);

  await writeInterview(repo, session);

  expect(existsSync(productDir)).toBe(true);
  expect(await readInterview(repo)).toEqual(session);
});

test("readInterview returns undefined when interview file is absent", async () => {
  expect(await readInterview(repo)).toBeUndefined();
});

test("readInterview returns undefined for malformed JSON", async () => {
  mkdirSync(join(repo, ".kunpeng", "product"), { recursive: true });
  writeFileSync(join(repo, ".kunpeng", "product", "interview.json"), "not json", "utf8");

  expect(await readInterview(repo)).toBeUndefined();
});
