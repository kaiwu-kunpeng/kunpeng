export interface AcceptAssertion {
  pattern: string;
  file: string;
  negated: boolean;
}

export interface AssertionVerdict extends AcceptAssertion {
  currentlyHolds: boolean;
  vacuous: boolean;
}

const COMMAND_SEPARATORS = new Set(["&&", "||", ";", "|", "\n"]);

function tokenize(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let started = false;

  const flush = (): void => {
    if (started) tokens.push(current);
    current = "";
    started = false;
  };

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];

    if (quote) {
      if (character === quote) {
        quote = null;
      } else if (quote === '"' && character === "\\" && index + 1 < command.length) {
        index += 1;
        current += command[index];
      } else {
        current += character;
      }
      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      started = true;
      continue;
    }

    if (character === "\\" && index + 1 < command.length) {
      started = true;
      index += 1;
      current += command[index];
      continue;
    }

    if (character === "\n") {
      flush();
      tokens.push("\n");
      continue;
    }

    if (/\s/.test(character)) {
      flush();
      continue;
    }

    const pair = command.slice(index, index + 2);
    if (pair === "&&" || pair === "||") {
      flush();
      tokens.push(pair);
      index += 1;
      continue;
    }

    if (character === ";" || character === "|") {
      flush();
      tokens.push(character);
      continue;
    }

    if (character === "!") {
      flush();
      tokens.push(character);
      continue;
    }

    started = true;
    current += character;
  }

  flush();
  return tokens;
}

function isQuietFlag(token: string): boolean {
  return token === "--quiet" || (/^-[^-]/.test(token) && token.slice(1).includes("q"));
}

function parseCommand(tokens: readonly string[]): AcceptAssertion | null {
  let index = 0;
  let negated = false;

  if (tokens[index] === "!") {
    negated = true;
    index += 1;
  }

  if (tokens[index] !== "grep") return null;
  index += 1;

  let hasQuietFlag = false;
  while (index < tokens.length && tokens[index].startsWith("-") && tokens[index] !== "-") {
    const flag = tokens[index];
    index += 1;
    if (flag === "--") break;
    if (isQuietFlag(flag)) hasQuietFlag = true;
  }

  if (!hasQuietFlag || index + 1 >= tokens.length) return null;
  return {
    pattern: tokens[index],
    file: tokens[index + 1],
    negated,
  };
}

export function parseAcceptAssertions(acceptCmd: string): AcceptAssertion[] {
  const assertions: AcceptAssertion[] = [];
  let command: string[] = [];

  for (const token of tokenize(acceptCmd)) {
    if (COMMAND_SEPARATORS.has(token)) {
      const assertion = parseCommand(command);
      if (assertion) assertions.push(assertion);
      command = [];
    } else {
      command.push(token);
    }
  }

  const assertion = parseCommand(command);
  if (assertion) assertions.push(assertion);
  return assertions;
}

export function judgeAssertions(
  assertions: readonly AcceptAssertion[],
  holds: (assertion: AcceptAssertion) => boolean,
): AssertionVerdict[] {
  return assertions.map((assertion) => {
    const currentlyHolds = holds(assertion);
    return {
      ...assertion,
      currentlyHolds,
      vacuous: assertion.negated ? !currentlyHolds : currentlyHolds,
    };
  });
}

export function summarizeAssertions(
  verdicts: readonly AssertionVerdict[],
): { total: number; vacuous: number; effective: number } {
  const total = verdicts.length;
  const vacuous = verdicts.filter((verdict) => verdict.vacuous).length;
  return { total, vacuous, effective: total - vacuous };
}
