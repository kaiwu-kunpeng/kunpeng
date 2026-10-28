import { defaultPageProvider } from "./page-provider.js";
import type {
  ActionDiscoverer,
  ActionSpec,
  CapturedRequest,
  DiscoverOpts,
  PageHandle,
  ParamSpec,
} from "./types.js";

const NETWORK_RESOURCE_TYPES = new Set(["xhr", "fetch"]);

function normalizeMethod(method: string): string {
  return method.trim().toUpperCase();
}

function slugPart(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function actionId(method: string, url: string): string {
  const parsed = new URL(url);
  const path = slugPart(parsed.pathname) || "root";
  return `${slugPart(method)}-${path}`;
}

function inferParamType(value: unknown): ParamSpec["type"] {
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (typeof value === "string") {
    if (/^(true|false)$/i.test(value)) return "boolean";
    if (/^-?\d+(\.\d+)?$/.test(value)) return "number";
  }
  return "string";
}

function queryParams(url: string): ParamSpec[] {
  const parsed = new URL(url);
  const seen = new Set<string>();
  const params: ParamSpec[] = [];

  for (const [name, value] of parsed.searchParams.entries()) {
    if (!name || seen.has(name)) continue;
    seen.add(name);
    params.push({ name, type: inferParamType(value), required: false, in: "query" });
  }

  return params;
}

function bodyParams(postData?: string): ParamSpec[] {
  if (!postData) return [];

  try {
    const parsed: unknown = JSON.parse(postData);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];

    return Object.entries(parsed).map(([name, value]) => ({
      name,
      type: inferParamType(value),
      required: true,
      in: "body",
    }));
  } catch {
    return [];
  }
}

function toAction(request: CapturedRequest): ActionSpec {
  const method = normalizeMethod(request.method);
  const parsed = new URL(request.url);
  const params = [...queryParams(request.url), ...bodyParams(request.postData)];

  return {
    id: actionId(method, request.url),
    kind: "network",
    title: `${method} ${parsed.pathname || "/"}`,
    target: { url: request.url, method },
    params,
    needsAuth: true,
  };
}

export class NetworkDiscoverer implements ActionDiscoverer {
  async discover(url: string, opts?: DiscoverOpts): Promise<ActionSpec[]> {
    const provider = opts?.pageProvider ?? defaultPageProvider();
    let page: PageHandle | undefined;

    try {
      page = await provider.open(url, { storageStatePath: opts?.storageStatePath });
      const requests = await page.capturedRequests();
      const deduped = new Map<string, CapturedRequest>();

      for (const request of requests) {
        const method = normalizeMethod(request.method);
        if (method === "GET") continue;
        if (!NETWORK_RESOURCE_TYPES.has(request.resourceType.toLowerCase())) continue;

        const key = `${method} ${request.url}`;
        if (!deduped.has(key)) deduped.set(key, { ...request, method });
      }

      const actions = Array.from(deduped.values()).map(toAction);
      return opts?.maxActions === undefined ? actions : actions.slice(0, opts.maxActions);
    } finally {
      await (page?.close() ?? Promise.resolve()).catch((error: unknown) => {
        console.warn("网络动作发现页面关闭失败", { url, error });
      });
    }
  }
}
