import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { defineSeoTool, type SeoToolContext, type SeoToolDef } from "./mcp-server.js";

export interface GscAuth {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  quotaProject?: string;
}

export function readGscAuth(opts: {
  env: Record<string, string | undefined>;
  home: string;
  readFile: (path: string) => string | undefined;
}): GscAuth | { error: string } {
  const path = opts.env.GOOGLE_APPLICATION_CREDENTIALS || join(opts.home, ".config/gcloud/application_default_credentials.json");
  const text = opts.readFile(path);
  if (text === undefined) return { error: `未找到 Google 默认凭据：${path}` };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: `Google 默认凭据不是合法 JSON：${path}` };
  }
  const data = parsed !== null && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  if (data.type !== "authorized_user") return { error: "仅支持 authorized_user 类型的默认凭据" };
  const { refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret } = data;
  if (typeof refreshToken !== "string" || !refreshToken || typeof clientId !== "string" || !clientId
    || typeof clientSecret !== "string" || !clientSecret) {
    return { error: "默认凭据缺少 refresh_token/client_id/client_secret" };
  }
  const quotaProject = opts.env.GSC_QUOTA_PROJECT
    || (typeof data.quota_project_id === "string" ? data.quota_project_id : "");
  return { refreshToken, clientId, clientSecret, ...(quotaProject ? { quotaProject } : {}) };
}

interface GscSite {
  siteUrl: string;
  permissionLevel: string;
}

interface GscRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

interface GscIndexStatus {
  verdict: string | null;
  coverageState: string | null;
  indexingState: string | null;
  robotsTxtState: string | null;
  pageFetchState: string | null;
  lastCrawlTime: string | null;
  googleCanonical: string | null;
  userCanonical: string | null;
}

export class GscClient {
  private accessToken: string | undefined;
  private expiresAt = 0;

  constructor(
    private readonly auth: GscAuth,
    private readonly fetchImpl: typeof fetch,
    private readonly now: () => number,
  ) {}

  async token(): Promise<string> {
    if (this.accessToken && this.now() < this.expiresAt) return this.accessToken;
    const response = await this.fetchImpl("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: this.auth.refreshToken,
        client_id: this.auth.clientId,
        client_secret: this.auth.clientSecret,
      }),
    });
    await this.checkResponse(response);
    const data = await response.json() as { access_token?: string; expires_in?: number };
    if (typeof data.access_token !== "string" || !data.access_token
      || typeof data.expires_in !== "number" || !Number.isFinite(data.expires_in) || data.expires_in <= 0) {
      throw new Error("GSC token: 响应缺少有效的 access_token/expires_in");
    }
    this.accessToken = data.access_token;
    this.expiresAt = this.now() + data.expires_in * 1000 - 60_000;
    return this.accessToken;
  }

  async listSites(): Promise<GscSite[]> {
    const data = await this.request("https://www.googleapis.com/webmasters/v3/sites") as { siteEntry?: GscSite[] };
    return (data.siteEntry ?? []).map(({ siteUrl, permissionLevel }) => ({ siteUrl, permissionLevel }))
      .sort((a, b) => a.siteUrl < b.siteUrl ? -1 : a.siteUrl > b.siteUrl ? 1 : 0);
  }

  async searchAnalytics(siteUrl: string, body: Record<string, unknown>): Promise<GscRow[]> {
    const data = await this.request(
      `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, body,
    ) as { rows?: Array<Omit<GscRow, "keys"> & { keys?: string[] }> };
    return (data.rows ?? []).map(({ keys, clicks, impressions, ctr, position }) => ({
      keys: keys ?? [], clicks, impressions, ctr, position,
    }));
  }

  async inspect(siteUrl: string, url: string): Promise<{ url: string } & GscIndexStatus> {
    const data = await this.request("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", {
      inspectionUrl: url, siteUrl,
    }) as { inspectionResult?: { indexStatusResult?: Partial<GscIndexStatus> } };
    const status = data.inspectionResult?.indexStatusResult;
    return {
      url,
      verdict: status?.verdict ?? null,
      coverageState: status?.coverageState ?? null,
      indexingState: status?.indexingState ?? null,
      robotsTxtState: status?.robotsTxtState ?? null,
      pageFetchState: status?.pageFetchState ?? null,
      lastCrawlTime: status?.lastCrawlTime ?? null,
      googleCanonical: status?.googleCanonical ?? null,
      userCanonical: status?.userCanonical ?? null,
    };
  }

  private async request(url: string, body?: Record<string, unknown>): Promise<unknown> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${await this.token()}`,
      "content-type": "application/json",
    };
    if (this.auth.quotaProject) headers["x-goog-user-project"] = this.auth.quotaProject;
    const response = await this.fetchImpl(url, {
      method: body === undefined ? "GET" : "POST",
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    await this.checkResponse(response);
    return response.json();
  }

  private async checkResponse(response: Response): Promise<void> {
    if (!response.ok) throw new Error(`GSC ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
}

async function withGscClient(
  ctx: SeoToolContext,
  run: (client: NonNullable<SeoToolContext["gscClient"]>) => Promise<unknown>,
): Promise<string> {
  try {
    if (!ctx.gscClient) {
      const auth = readGscAuth({
        env: process.env, home: homedir(),
        readFile: (path) => {
          try { return readFileSync(path, "utf8"); } catch { return undefined; }
        },
      });
      if ("error" in auth) return JSON.stringify({ ok: false, error: auth.error });
      ctx.gscClient = new GscClient(auth, ctx.fetchImpl, ctx.now);
    }
    return JSON.stringify(await run(ctx.gscClient));
  } catch (error) {
    return JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

export function gscTools(): SeoToolDef[] {
  return [defineSeoTool({
    name: "seo_gsc_sites",
    description: "列出 Google Search Console 已授权的站点及权限。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    run: async (_args, ctx) => withGscClient(ctx, async (client) => ({ ok: true, sites: await client.listSites() })),
  }), defineSeoTool({
    name: "seo_gsc_query",
    description: "查询 Google Search Console 搜索表现，支持日期、维度与查询词/页面过滤。",
    inputSchema: {
      type: "object",
      properties: {
        siteUrl: { type: "string" }, startDate: { type: "string" }, endDate: { type: "string" },
        dimensions: { type: "array", items: { type: "string" } }, rowLimit: { type: "number" },
        query: { type: "string" }, page: { type: "string" },
      },
      required: ["siteUrl"], additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    run: async (args, ctx) => withGscClient(ctx, async (client) => {
      const siteUrl = String(args.siteUrl);
      const day = 86_400_000;
      const endDate = typeof args.endDate === "string" ? args.endDate : new Date(ctx.now() - 3 * day).toISOString().slice(0, 10);
      const startDate = typeof args.startDate === "string" ? args.startDate : new Date(Date.parse(endDate) - 27 * day).toISOString().slice(0, 10);
      const allowedDimensions = ["query", "page", "country", "device", "date", "searchAppearance"];
      const dimensions = Array.isArray(args.dimensions)
        ? args.dimensions.filter((value): value is string => typeof value === "string" && allowedDimensions.includes(value)) : [];
      const rowLimit = Math.min(25000, Math.max(1,
        typeof args.rowLimit === "number" && Number.isFinite(args.rowLimit) ? Math.trunc(args.rowLimit) : 1000));
      const filters: Array<{ dimension: string; operator: "contains"; expression: string }> = [];
      for (const dimension of ["query", "page"]) {
        const expression = args[dimension];
        if (typeof expression === "string" && expression.length > 0) filters.push({ dimension, operator: "contains", expression });
      }
      const rows = await client.searchAnalytics(siteUrl, {
        startDate, endDate, dimensions, rowLimit,
        ...(filters.length > 0 ? { dimensionFilterGroups: [{ filters }] } : {}),
      });
      return { ok: true, siteUrl, startDate, endDate, dimensions, rows };
    }),
  }), defineSeoTool({
    name: "seo_gsc_inspect",
    description: "串行检查最多 50 个 URL 的 Google 索引状态，汇总覆盖状态及逐项错误。",
    inputSchema: {
      type: "object",
      properties: { siteUrl: { type: "string" }, urls: { type: "array", items: { type: "string" } } },
      required: ["siteUrl", "urls"], additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    run: async (args, ctx) => withGscClient(ctx, async (client) => {
      const siteUrl = String(args.siteUrl);
      const urls = Array.isArray(args.urls)
        ? args.urls.slice(0, 50).filter((url): url is string => typeof url === "string") : [];
      const results: Array<Awaited<ReturnType<typeof client.inspect>>> = [];
      const errors: Array<{ url: string; error: string }> = [];
      const coverage = new Map<string, number>();
      for (const url of urls) {
        try {
          const result = await client.inspect(siteUrl, url);
          results.push(result);
          const state = result.coverageState ?? "unknown";
          coverage.set(state, (coverage.get(state) ?? 0) + 1);
        } catch (error) {
          errors.push({ url, error: error instanceof Error ? error.message : String(error) });
        }
      }
      return { ok: true, siteUrl, checked: urls.length, results, errors, coverage: Object.fromEntries(coverage) };
    }),
  })];
}
