import type { Finding } from "../page-audit.js";

export type BotClass = "training" | "search" | "user";

export interface BotEntry {
  agent: string;
  class: BotClass;
  vendor: string;
}

export const AI_BOT_CLASSES: readonly BotEntry[] = [
  { agent: "GPTBot", class: "training", vendor: "OpenAI" },
  { agent: "ClaudeBot", class: "training", vendor: "Anthropic" },
  { agent: "anthropic-ai", class: "training", vendor: "Anthropic" },
  { agent: "Google-Extended", class: "training", vendor: "Google" },
  { agent: "CCBot", class: "training", vendor: "Common Crawl" },
  { agent: "Bytespider", class: "training", vendor: "ByteDance" },
  { agent: "Applebot-Extended", class: "training", vendor: "Apple" },
  { agent: "meta-externalagent", class: "training", vendor: "Meta" },
  { agent: "Amazonbot", class: "training", vendor: "Amazon" },
  { agent: "Googlebot", class: "search", vendor: "Google" },
  { agent: "Bingbot", class: "search", vendor: "Microsoft" },
  { agent: "OAI-SearchBot", class: "search", vendor: "OpenAI" },
  { agent: "Claude-SearchBot", class: "search", vendor: "Anthropic" },
  { agent: "PerplexityBot", class: "search", vendor: "Perplexity" },
  { agent: "Applebot", class: "search", vendor: "Apple" },
  { agent: "DuckDuckBot", class: "search", vendor: "DuckDuckGo" },
  { agent: "YandexBot", class: "search", vendor: "Yandex" },
  { agent: "ChatGPT-User", class: "user", vendor: "OpenAI" },
  { agent: "Claude-User", class: "user", vendor: "Anthropic" },
  { agent: "Perplexity-User", class: "user", vendor: "Perplexity" },
  { agent: "meta-externalfetcher", class: "user", vendor: "Meta" },
];

export interface RobotsRule {
  type: "allow" | "disallow";
  path: string;
}

export interface RobotsGroup {
  agents: string[];
  rules: RobotsRule[];
}

export interface ParsedRobots {
  groups: RobotsGroup[];
  sitemaps: string[];
  host?: string;
}

export function parseRobotsGroups(text: string): ParsedRobots {
  const parsed: ParsedRobots = { groups: [], sitemaps: [] };
  let current: RobotsGroup | undefined;
  for (const rawLine of text.split(/\r\n?|\n/)) {
    const line = rawLine.split("#", 1)[0].trim();
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === "user-agent") {
      if (!current || current.rules.length > 0) {
        current = { agents: [], rules: [] };
        parsed.groups.push(current);
      }
      current.agents.push(value);
    } else if (field === "sitemap") {
      parsed.sitemaps.push(value);
    } else if (field === "host") {
      parsed.host = value;
    } else if (current && (field === "allow" || field === "disallow")) {
      if (value) current.rules.push({ type: field, path: value });
      else if (field === "disallow") current.rules.push({ type: "allow", path: "/" });
    }
  }
  return parsed;
}

function matchingToken(group: RobotsGroup, agent: string): string | undefined {
  const lowerAgent = agent.toLowerCase();
  let longest: string | undefined;
  for (const token of group.agents) {
    if (token !== "*" && lowerAgent.includes(token.toLowerCase())
      && (longest === undefined || token.length > longest.length)) {
      longest = token;
    }
  }
  return longest;
}

export function effectiveGroup(parsed: ParsedRobots, agent: string): RobotsGroup | undefined {
  let matched: RobotsGroup | undefined;
  let longest = -1;
  for (const group of parsed.groups) {
    const token = matchingToken(group, agent);
    if (token !== undefined && token.length > longest) {
      matched = group;
      longest = token.length;
    }
  }
  return matched ?? parsed.groups.find((group) => group.agents.includes("*"));
}

export type RobotsVerdict = "allowed" | "partial" | "blocked";

export function robotsPatternMatches(pattern: string, pathWithQuery: string): boolean {
  const anchored = pattern.endsWith("$");
  const parts = (anchored ? pattern.slice(0, -1) : pattern).split("*");
  if (!pathWithQuery.startsWith(parts[0])) return false;
  let offset = parts[0].length;
  for (let index = 1; index < parts.length; index++) {
    const part = parts[index];
    // An anchored final literal must end the path, without overlapping prior literals.
    if (anchored && index === parts.length - 1) {
      return pathWithQuery.endsWith(part) && pathWithQuery.length - part.length >= offset;
    }
    const found = pathWithQuery.indexOf(part, offset);
    if (found < 0) return false;
    offset = found + part.length;
  }
  return !anchored || offset === pathWithQuery.length;
}

function winnerAt(group: RobotsGroup, path: string): RobotsRule | undefined {
  let winner: RobotsRule | undefined;
  for (const rule of group.rules) {
    if (robotsPatternMatches(rule.path, path) && (!winner || rule.path.length > winner.path.length
      || (rule.path.length === winner.path.length && rule.type === "allow"))) {
      winner = rule;
    }
  }
  return winner;
}

export function verdictFor(group: RobotsGroup | undefined, path = "/"): RobotsVerdict {
  if (!group || group.rules.length === 0) return "allowed";
  if (winnerAt(group, path)?.type === "disallow") return "blocked";
  // Check effective descendant rules directly, without recursive verdict calls.
  if (group.rules.some((rule) => rule.type === "disallow" && rule.path.startsWith(path)
    && winnerAt(group, rule.path)?.type === "disallow")) return "partial";
  if (group.rules.some((rule) => {
    if (rule.type !== "disallow" || (!rule.path.includes("*") && !rule.path.endsWith("$"))) return false;
    const prefix = rule.path.slice(0, rule.path.search(/[*$]/));
    return prefix.startsWith(path) || path.startsWith(prefix);
  })) return "partial";
  return "allowed";
}

export function isAllowedByRobots(parsed: ParsedRobots, userAgent: string, pathWithQuery: string): boolean {
  const group = effectiveGroup(parsed, userAgent);
  return !group || winnerAt(group, pathWithQuery)?.type !== "disallow";
}

export interface RobotsClassReport {
  agent: string;
  class: BotClass;
  vendor: string;
  verdict: RobotsVerdict;
  matchedGroup: string;
}

export interface RobotsPolicy {
  training?: "allow" | "block" | "any";
  search?: "allow" | "any";
  user?: "allow" | "any";
}

export interface RobotsGateInput {
  robotsTxt: string;
  policy?: RobotsPolicy;
  requireSitemap?: boolean;
}

export interface RobotsGateResult {
  ok: boolean;
  findings: Finding[];
  reports: RobotsClassReport[];
  sitemaps: string[];
  wildcardBlocksAll: boolean;
  unknownAgents: string[];
}

export function runRobotsGate(input: RobotsGateInput): RobotsGateResult {
  const parsed = parseRobotsGroups(input.robotsTxt);
  const reports: RobotsClassReport[] = AI_BOT_CLASSES.map((bot) => {
    const group = effectiveGroup(parsed, bot.agent);
    return {
      ...bot,
      verdict: verdictFor(group, "/"),
      matchedGroup: group ? matchingToken(group, bot.agent) ?? "*" : "none",
    };
  });
  const wildcard = parsed.groups.find((group) => group.agents.includes("*"));
  const wildcardBlocksAll = verdictFor(wildcard, "/") === "blocked";
  const known = new Set(AI_BOT_CLASSES.map((bot) => bot.agent.toLowerCase()));
  const seen = new Set<string>();
  const unknownAgents: string[] = [];
  for (const group of parsed.groups) {
    for (const agent of group.agents) {
      const lower = agent.toLowerCase();
      if (agent !== "*" && !known.has(lower) && !seen.has(lower)) {
        unknownAgents.push(agent);
        seen.add(lower);
      }
    }
  }

  const findings: Finding[] = [];
  if (wildcardBlocksAll) findings.push({
    rule: "robots-wildcard-block-all",
    severity: "error",
    message: "The wildcard user-agent group blocks the entire site.",
  });
  for (const botClass of ["search", "user"] as const) {
    if ((input.policy?.[botClass] ?? "allow") !== "allow") continue;
    for (const report of reports) {
      if (report.class === botClass && report.verdict === "blocked") findings.push({
        rule: botClass === "search" ? "robots-search-blocked" : "robots-user-blocked",
        severity: "error",
        message: `${report.agent} is blocked by robots.txt.`,
        evidence: report.agent,
      });
    }
  }
  const training = input.policy?.training ?? "any";
  for (const report of reports) {
    if (report.class !== "training") continue;
    if ((training === "allow" && report.verdict === "blocked")
      || (training === "block" && report.verdict !== "blocked")) findings.push({
      rule: "robots-training-policy",
      severity: "warn",
      message: `${report.agent} is ${report.verdict}; training policy requires ${training}.`,
      evidence: report.agent,
    });
  }
  if ((input.requireSitemap ?? true) && parsed.sitemaps.length === 0) findings.push({
    rule: "robots-sitemap-missing",
    severity: "warn",
    message: "No Sitemap directive was found in robots.txt.",
  });
  if (unknownAgents.length > 0) findings.push({
    rule: "robots-unknown-agent",
    severity: "info",
    message: "robots.txt contains user-agent tokens outside the AI bot dictionary.",
    evidence: unknownAgents.join(", "),
  });
  return {
    ok: !findings.some((finding) => finding.severity === "error"),
    findings,
    reports,
    sitemaps: parsed.sitemaps,
    wildcardBlocksAll,
    unknownAgents,
  };
}

function statusFailure(status: number, evidence: string): RobotsGateResult & { status: number } {
  return {
    ok: false,
    findings: [{
      rule: "robots-status",
      severity: "error",
      message: `Unable to read robots.txt: ${evidence}`,
      evidence,
    }],
    reports: [],
    sitemaps: [],
    wildcardBlocksAll: false,
    unknownAgents: [],
    status,
  };
}

export async function fetchRobotsGate(opts: {
  origin: string;
  fetchImpl?: typeof fetch;
  userAgent?: string;
  policy?: RobotsPolicy;
  requireSitemap?: boolean;
}): Promise<RobotsGateResult & { status: number }> {
  try {
    const response = await (opts.fetchImpl ?? fetch)(`${opts.origin.replace(/\/+$/, "")}/robots.txt`, {
      method: "GET",
      headers: { "user-agent": opts.userAgent ?? "kunpeng-seo/0.1" },
    });
    const status = response.status;
    if (status !== 200 && status !== 404) return statusFailure(status, String(status));
    const result = runRobotsGate({
      robotsTxt: status === 200 ? await response.text() : "",
      policy: opts.policy,
      requireSitemap: opts.requireSitemap,
    });
    if (status === 404) result.findings.unshift({
      rule: "robots-missing",
      severity: "warn",
      message: "robots.txt was not found; evaluated as an empty file.",
    });
    return { ...result, status };
  } catch (error) {
    return statusFailure(0, error instanceof Error ? error.message : String(error));
  }
}
