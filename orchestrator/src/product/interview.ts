import type { InterviewSession, ProductDefineFaqAnswer } from "./contract.js";
import { INTERVIEW_QUESTIONS, PRODUCT_DEFINE_FAQ_ANCHORS } from "./contract.js";

export function startInterview(idea: string): InterviewSession {
  return { idea, status: "in-progress", step: 0, answers: [] };
}

export function currentQuestion(session: InterviewSession): string | undefined {
  return session.step < INTERVIEW_QUESTIONS.length ? INTERVIEW_QUESTIONS[session.step] : undefined;
}

export function submitAnswer(session: InterviewSession, answer: string): InterviewSession {
  if (isComplete(session)) {
    return { ...session, answers: [...session.answers] };
  }

  return {
    ...session,
    step: session.step + 1,
    answers: [...session.answers, answer],
  };
}

export function isAllAnswered(session: InterviewSession): boolean {
  return session.step >= INTERVIEW_QUESTIONS.length;
}

export function isComplete(session: InterviewSession): boolean {
  return session.status === "done";
}

export function buildDefineFaqAnswers(session: InterviewSession): ProductDefineFaqAnswer[] {
  return PRODUCT_DEFINE_FAQ_ANCHORS.map((item, index) => ({
    anchor: item.anchor,
    label: item.label,
    question: item.question,
    answer: session.answers[index] ?? "",
  }));
}
