import { isRecord } from "../util/is-record.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { errorMessage } from "../util/errors.js";

export interface QaScriptStep {
  action: "goto" | "click" | "fill" | "expectText" | "expectSelector";
  target?: string;
  value?: string;
  note?: string;
}

export interface QaPageLike {
  goto(url: string): Promise<unknown>;
  click(selector: string): Promise<unknown>;
  fill(selector: string, value: string): Promise<unknown>;
  bodyText(): Promise<string>;
  count(selector: string): Promise<number>;
}

export interface QaScriptResult {
  step: QaScriptStep;
  ok: boolean;
  error?: string;
}

const qaScriptActions = new Set<QaScriptStep["action"]>([
  "goto",
  "click",
  "fill",
  "expectText",
  "expectSelector",
]);

function isQaScriptAction(value: unknown): value is QaScriptStep["action"] {
  return typeof value === "string" && qaScriptActions.has(value as QaScriptStep["action"]);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function parseQaScriptStep(value: unknown): QaScriptStep | undefined {
  if (!isRecord(value) || !isQaScriptAction(value.action)) return undefined;
  return {
    action: value.action,
    ...(optionalString(value.target) !== undefined ? { target: optionalString(value.target) } : {}),
    ...(optionalString(value.value) !== undefined ? { value: optionalString(value.value) } : {}),
    ...(optionalString(value.note) !== undefined ? { note: optionalString(value.note) } : {}),
  };
}

export async function readQaScript(repoRoot: string, slug: string): Promise<QaScriptStep[]> {
  try {
    const raw = await readFile(join(repoRoot, ".kunpeng", "product", slug, "qa-script.json"), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      const step = parseQaScriptStep(item);
      return step === undefined ? [] : [step];
    });
  } catch {
    return [];
  }
}

function requiredString(value: string | undefined, field: "target" | "value"): string {
  if (value === undefined) throw new Error(`${field} 缺失`);
  return value;
}

function summarize(value: string): string {
  return value.length > 80 ? `${value.slice(0, 77)}...` : value;
}

function describeStep(step: QaScriptStep): string {
  const parts: string[] = [step.action];
  if (step.target !== undefined) parts.push(summarize(step.target));
  if (step.value !== undefined) parts.push(summarize(step.value));
  return parts.join(" ");
}

async function executeStep(page: QaPageLike, baseUrl: string, step: QaScriptStep): Promise<void> {
  switch (step.action) {
    case "goto": {
      const target = requiredString(step.target, "target");
      await page.goto(new URL(target, baseUrl).toString());
      return;
    }
    case "click": {
      await page.click(requiredString(step.target, "target"));
      return;
    }
    case "fill": {
      await page.fill(requiredString(step.target, "target"), requiredString(step.value, "value"));
      return;
    }
    case "expectText": {
      const expected = requiredString(step.value, "value");
      const text = await page.bodyText();
      if (!text.includes(expected)) throw new Error(`页面文本未包含 ${summarize(expected)}`);
      return;
    }
    case "expectSelector": {
      const target = requiredString(step.target, "target");
      const count = await page.count(target);
      if (count < 1) throw new Error(`选择器匹配 0 个元素`);
      return;
    }
  }
}

export async function executeQaScript(
  page: QaPageLike,
  baseUrl: string,
  steps: QaScriptStep[],
): Promise<QaScriptResult[]> {
  const results: QaScriptResult[] = [];
  for (const step of steps) {
    try {
      await executeStep(page, baseUrl, step);
      results.push({ step, ok: true });
    } catch (error) {
      results.push({ step, ok: false, error: `${describeStep(step)}: ${errorMessage(error)}` });
      return results;
    }
  }
  return results;
}
