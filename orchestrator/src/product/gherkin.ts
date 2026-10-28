export interface GherkinScenario {
  title: string;
  given: string[];
  when: string[];
  then: string[];
}

export interface GherkinValidation {
  ok: boolean;
  errors: string[];
}

type StepKind = "given" | "when" | "then";

function emptyScenario(title: string): GherkinScenario {
  return { title, given: [], when: [], then: [] };
}

function stepTarget(scenario: GherkinScenario, kind: StepKind): string[] {
  if (kind === "given") {
    return scenario.given;
  }
  if (kind === "when") {
    return scenario.when;
  }
  return scenario.then;
}

function stripStepKeyword(line: string, keyword: string): string {
  return line.slice(keyword.length).replace(/^[:：]?\s*/, "").trim();
}

function matchStep(line: string): { kind: StepKind | "and"; text: string } | undefined {
  const english = /^(given|when|then|and)\b\s*:?\s*(.*)$/i.exec(line);
  if (english !== null) {
    const keyword = english[1].toLowerCase();
    const text = english[2].trim();
    if (keyword === "given" || keyword === "when" || keyword === "then" || keyword === "and") {
      return { kind: keyword, text };
    }
  }

  const chineseKeywords: Array<[string, StepKind | "and"]> = [
    ["假设", "given"],
    ["那么", "then"],
    ["并且", "and"],
    ["当", "when"],
  ];
  const found = chineseKeywords.find(([keyword]) => line.startsWith(keyword));
  if (found === undefined) {
    return undefined;
  }

  const [keyword, kind] = found;
  const text = stripStepKeyword(line, keyword);
  return { kind, text: kind === "when" && text.endsWith("时") ? text.slice(0, -1) : text };
}

export function parseGherkin(text: string): GherkinScenario[] {
  const scenarios: GherkinScenario[] = [];
  let current: GherkinScenario | undefined;
  let lastStepKind: StepKind | undefined;
  let sawScenario = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "") {
      continue;
    }

    const scenarioMatch = /^(scenario|场景)\s*[:：]\s*(.*)$/i.exec(line);
    if (scenarioMatch !== null) {
      sawScenario = true;
      current = emptyScenario(scenarioMatch[2].trim() || "（未命名）");
      scenarios.push(current);
      lastStepKind = undefined;
      continue;
    }

    if (/^(feature|功能)\s*[:：]/i.test(line)) {
      continue;
    }

    const step = matchStep(line);
    if (step === undefined) {
      continue;
    }

    if (current === undefined) {
      current = emptyScenario("（未命名）");
      scenarios.push(current);
    }

    if (step.kind === "and") {
      if (lastStepKind !== undefined) {
        stepTarget(current, lastStepKind).push(step.text);
      }
      continue;
    }

    stepTarget(current, step.kind).push(step.text);
    lastStepKind = step.kind;
  }

  if (!sawScenario && scenarios.length === 0) {
    return [emptyScenario("（未命名）")];
  }

  return scenarios;
}

function containsGherkinStep(text: string): boolean {
  return /(^|\n)\s*(when|then)\b/i.test(text) || /(^|\n)\s*(当|那么)/.test(text);
}

function truncateTitle(text: string): string {
  return text.length <= 60 ? text : `${text.slice(0, 60)}…`;
}

export function liftAcceptance(acceptance: string[]): GherkinScenario[] {
  return acceptance.map((item) => {
    if (containsGherkinStep(item)) {
      const parsed = parseGherkin(item)[0];
      if (parsed !== undefined && parsed.then.length > 0) {
        return parsed;
      }
    }

    return {
      title: truncateTitle(item),
      given: [],
      when: ["执行相关操作"],
      then: [item],
    };
  });
}

export function validateScenarios(scenarios: GherkinScenario[]): GherkinValidation {
  const errors: string[] = [];

  for (const scenario of scenarios) {
    if (scenario.when.length === 0) {
      errors.push(`场景「${scenario.title}」缺少 When 步骤`);
    }
    if (scenario.then.length === 0) {
      errors.push(`场景「${scenario.title}」缺少 Then 步骤`);
    }
  }

  return { ok: errors.length === 0, errors };
}

function renderSteps(keyword: "Given" | "When" | "Then", steps: string[]): string[] {
  return steps.map((step, index) => `  ${index === 0 ? keyword : "And"} ${step}`);
}

export function renderGherkin(scenarios: GherkinScenario[]): string {
  if (scenarios.length === 0) {
    return "";
  }

  const lines = scenarios.flatMap((scenario, index) => [
    ...(index === 0 ? [] : [""]),
    `Scenario: ${scenario.title}`,
    ...renderSteps("Given", scenario.given),
    ...renderSteps("When", scenario.when),
    ...renderSteps("Then", scenario.then),
  ]);

  return ["```gherkin", ...lines, "```"].join("\n");
}
