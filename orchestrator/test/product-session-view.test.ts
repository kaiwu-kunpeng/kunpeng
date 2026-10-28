import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { INTERVIEW_QUESTIONS, type InterviewSession, type ProductDefinition } from "../src/product/contract.js";
import { startInterview, submitAnswer } from "../src/product/interview.js";
import { writeInterview } from "../src/product/store.js";
import { readProductSessionView } from "../src/server/state.js";

let repo: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "kp-product-session-view-"));
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

test("projects an in-progress interview session", async () => {
  const session = submitAnswer(
    submitAnswer(startInterview("做个待办"), "管理个人任务"),
    "个人用户",
  );
  await writeInterview(repo, session);

  const view = await readProductSessionView(repo);

  expect(view?.status).toBe("in-progress");
  expect(view?.idea).toBe("做个待办");
  expect(view?.answeredCount).toBe(2);
  expect(view?.totalQuestions).toBe(5);
  expect(view?.currentQuestion).toBe(INTERVIEW_QUESTIONS[2]);
  expect(view?.definition).toBeUndefined();
});

test("projects a done interview session with definition", async () => {
  const definition: ProductDefinition = {
    idea: "做个待办",
    problem: "任务容易遗漏",
    users: ["个人用户", "自由职业者"],
    stories: ["创建任务", "标记完成"],
    acceptance: ["能新增任务", "能完成任务"],
  };
  const session: InterviewSession = {
    idea: "做个待办",
    status: "done",
    step: 5,
    answers: ["a", "b", "c", "d", "e"],
    definition,
  };
  await writeInterview(repo, session);

  const view = await readProductSessionView(repo);

  expect(view?.status).toBe("done");
  expect(view?.currentQuestion).toBeUndefined();
  expect(view?.definition).toEqual(definition);
  expect(view?.definition?.idea).toBe("做个待办");
  expect(view?.definition?.problem).toBe("任务容易遗漏");
  expect(view?.definition?.users).toEqual(["个人用户", "自由职业者"]);
  expect(view?.definition?.stories).toEqual(["创建任务", "标记完成"]);
  expect(view?.definition?.acceptance).toEqual(["能新增任务", "能完成任务"]);
});

test("returns undefined when interview file is absent", async () => {
  await expect(readProductSessionView(repo)).resolves.toBeUndefined();
});
