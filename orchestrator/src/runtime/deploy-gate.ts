export interface PublicRoute {
  kind: "http" | "ws";
  path: string;
}

export interface HoldState {
  held: boolean;
  reason?: string;
  at?: number;
}

function routeKey(route: PublicRoute): string {
  return `${route.kind}\u0000${route.path}`;
}

function stableRoutes(routes: PublicRoute[]): PublicRoute[] {
  const unique = new Map<string, PublicRoute>();
  for (const route of routes) unique.set(routeKey(route), route);
  return [...unique.values()].sort((left, right) => {
    const leftKey = routeKey(left);
    const rightKey = routeKey(right);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
}

function extractHttpRoutes(source: string): PublicRoute[] {
  const starts = [...source.matchAll(/registerModularRoute\s*\(/g)].map((match) => match.index);
  const routes: PublicRoute[] = [];
  for (let index = 0; index < starts.length; index++) {
    const start = starts[index] ?? 0;
    const end = starts[index + 1] ?? source.length;
    const call = source.slice(start, end);
    const path = /\bpath\s*:\s*(["'`])((?:\\.|[^\\\r\n])*?)\1/.exec(call)?.[2];
    if (path !== undefined && !path.includes("${")) routes.push({ kind: "http", path });
  }
  return routes;
}

function extractWsRoutes(source: string): PublicRoute[] {
  if (!/registerUpgradeRoute\s*\(/.test(source)) return [];

  const routes: PublicRoute[] = [];
  const stringPath = /\bconst\s+[A-Za-z_$][\w$]*PATH\s*=\s*(["'`])((?:\\.|[^\\\r\n])*?)\1/gi;
  for (const match of source.matchAll(stringPath)) {
    const path = match[2];
    if (path !== undefined && !path.includes("${")) routes.push({ kind: "ws", path });
  }

  const regexPathStart = /\bconst\s+[A-Za-z_$][\w$]*PATH\s*=\s*\//gi;
  for (const match of source.matchAll(regexPathStart)) {
    const start = (match.index ?? 0) + match[0].length;
    let escaped = false;
    let inCharacterClass = false;
    for (let index = start; index < source.length; index++) {
      const character = source[index];
      if (character === "\n" || character === "\r") break;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === "\\") {
        escaped = true;
        continue;
      }
      if (character === "[") inCharacterClass = true;
      else if (character === "]") inCharacterClass = false;
      else if (character === "/" && !inCharacterClass) {
        routes.push({ kind: "ws", path: source.slice(start, index) });
        break;
      }
    }
  }
  return routes;
}

export function extractPublicRoutes(sources: Record<string, string>): PublicRoute[] {
  try {
    const routes: PublicRoute[] = [];
    for (const source of Object.values(sources)) {
      if (typeof source !== "string") continue;
      routes.push(...extractHttpRoutes(source), ...extractWsRoutes(source));
    }
    return stableRoutes(routes);
  } catch {
    return [];
  }
}

export function diffPublicSurface(
  before: PublicRoute[],
  after: PublicRoute[],
): { added: PublicRoute[]; removed: PublicRoute[] } {
  const stableBefore = stableRoutes(before);
  const stableAfter = stableRoutes(after);
  const beforeKeys = new Set(stableBefore.map(routeKey));
  const afterKeys = new Set(stableAfter.map(routeKey));
  return {
    added: stableAfter.filter((route) => !beforeKeys.has(routeKey(route))),
    removed: stableBefore.filter((route) => !afterKeys.has(routeKey(route))),
  };
}

export function parseHold(raw: string | null): HoldState {
  if (raw === null || raw.trim() === "") return { held: false };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object"
      || parsed === null
      || Array.isArray(parsed)
      || !("held" in parsed)
      || typeof parsed.held !== "boolean"
    ) {
      return { held: true, reason: "闸状态文件损坏，按拦住处理" };
    }
    if (!parsed.held) return { held: false };
    const result: HoldState = { held: true };
    if ("reason" in parsed && typeof parsed.reason === "string") result.reason = parsed.reason;
    if ("at" in parsed && typeof parsed.at === "number") result.at = parsed.at;
    return result;
  } catch {
    return { held: true, reason: "闸状态文件损坏，按拦住处理" };
  }
}

export function formatGateDecision(input: {
  held: HoldState;
  behind: number;
  added: PublicRoute[];
}): { allow: boolean; lines: string[] } {
  const allow = !input.held.held;
  const lines = [
    allow
      ? "部署闸：放行"
      : `部署闸：拦住（${input.held.reason ?? "未说明"}）`,
    `线上落后 main：${input.behind} 个提交`,
  ];
  const added = stableRoutes(input.added);
  if (added.length > 0) {
    lines.push("本次推进新增对外端点：");
    for (const route of added) lines.push(`  + ${route.kind.toUpperCase()} ${route.path}`);
  }
  return { allow, lines };
}
