import { expect, test } from "vitest";
import {
  INTERVIEW_QUESTIONS,
  PRODUCT_DEFINE_FAQ_ANCHORS,
  type InterviewSession,
} from "../src/product/contract.js";
import {
  buildDefineFaqAnswers,
  currentQuestion,
  isAllAnswered,
  isComplete,
  startInterview,
  submitAnswer,
} from "../src/product/interview.js";

test("startInterview creates an in-progress session at the first step", () => {
  const session = startInterview("做个待办");

  expect(session.idea).toBe("做个待办");
  expect(session.status).toBe("in-progress");
  expect(session.step).toBe(0);
  expect(session.answers).toEqual([]);
});

test("interview questions are derived from PR FAQ anchors", () => {
  expect(PRODUCT_DEFINE_FAQ_ANCHORS.map((item) => item.question)).toEqual(INTERVIEW_QUESTIONS);
  expect(PRODUCT_DEFINE_FAQ_ANCHORS.map((item) => item.anchor)).toEqual([
    "prfaq-problem",
    "prfaq-users",
    "prfaq-scenarios",
    "prfaq-success",
    "prfaq-non-goals",
  ]);
});

test("buildDefineFaqAnswers returns anchored PR FAQ answer artifacts", () => {
  const session = submitAnswer(startInterview("做个待办"), "任务容易漏");

  expect(buildDefineFaqAnswers(session)).toEqual([
    {
      anchor: "prfaq-problem",
      label: "问题",
      question: "这个产品/功能要解决什么问题？",
      answer: "任务容易漏",
    },
    {
      anchor: "prfaq-users",
      label: "目标用户",
      question: "目标用户是谁？",
      answer: "",
    },
    {
      anchor: "prfaq-scenarios",
      label: "核心场景",
      question: "核心使用场景是什么？",
      answer: "",
    },
    {
      anchor: "prfaq-success",
      label: "成功标准",
      question: "怎样算成功（验收标准）？",
      answer: "",
    },
    {
      anchor: "prfaq-non-goals",
      label: "非目标",
      question: "明确不做什么（非目标）？",
      answer: "",
    },
  ]);
});

test("currentQuestion advances through the fixed five-question skeleton", () => {
  let session = startInterview("做个待办");
  expect(currentQuestion(session)).toBe(INTERVIEW_QUESTIONS[0]);

  for (let index = 0; index < INTERVIEW_QUESTIONS.length; index += 1) {
    session = submitAnswer(session, `answer-${index}`);
    expect(currentQuestion(session)).toBe(INTERVIEW_QUESTIONS[index + 1]);
  }

  expect(currentQuestion(session)).toBeUndefined();
});

test("submitAnswer returns a new session without mutating the input", () => {
  const original = startInterview("做个待办");
  const originalAnswers = original.answers;
  const next = submitAnswer(original, "先记录任务");

  expect(original.step).toBe(0);
  expect(original.answers).toEqual([]);
  expect(original.answers).toBe(originalAnswers);
  expect(next).not.toBe(original);
  expect(next.answers).toEqual(["先记录任务"]);
  expect(next.step).toBe(1);
});

test("answering all five questions marks all answered but keeps the session in progress", () => {
  let session = startInterview("做个待办");
  for (let index = 0; index < INTERVIEW_QUESTIONS.length; index += 1) {
    session = submitAnswer(session, `answer-${index}`);
  }

  expect(isAllAnswered(session)).toBe(true);
  expect(currentQuestion(session)).toBeUndefined();
  expect(session.status).toBe("in-progress");
});

test("isComplete only reflects done status", () => {
  expect(isComplete(startInterview("做个待办"))).toBe(false);

  const doneSession: InterviewSession = {
    idea: "做个待办",
    status: "done",
    step: 5,
    answers: ["a", "b", "c", "d", "e"],
  };
  expect(isComplete(doneSession)).toBe(true);
});

test("submitAnswer does not advance done sessions", () => {
  const doneSession: InterviewSession = {
    idea: "做个待办",
    status: "done",
    step: 5,
    answers: ["a", "b", "c", "d", "e"],
  };

  const next = submitAnswer(doneSession, "ignored");

  expect(next).not.toBe(doneSession);
  expect(next).toEqual(doneSession);
  expect(next.step).toBe(5);
  expect(next.answers).toEqual(["a", "b", "c", "d", "e"]);
});
