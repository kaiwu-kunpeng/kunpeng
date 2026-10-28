/** MCP 双代兼容（dual-era）：老客户端走 initialize 握手，新客户端（2026-07-28）每个请求在 _meta 里带版本、无状态。
 *  五个自建 MCP server 共用这里的判定，避免各自硬编码协议版本。纯函数，不做 I/O。 */
import { isRecord } from "../util/is-record.js";

export const MODERN_PROTOCOL_VERSION = "2026-07-28";
export const LEGACY_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"] as const;
export const SUPPORTED_PROTOCOL_VERSIONS: readonly string[] = [MODERN_PROTOCOL_VERSION, ...LEGACY_PROTOCOL_VERSIONS];
/** 老客户端没说版本、或说了我们不认识的老版本时的回退值（保持升级前的行为）。 */
export const DEFAULT_LEGACY_VERSION = "2024-11-05";
export const UNSUPPORTED_PROTOCOL_VERSION_CODE = -32022;
export const LIST_CACHE = { ttlMs: 300_000, cacheScope: "public" } as const;

const META_PROTOCOL_VERSION = "io.modelcontextprotocol/protocolVersion";
const META_SERVER_INFO = "io.modelcontextprotocol/serverInfo";

export interface McpServerIdentity {
  name: string;
  version: string;
  capabilities?: Record<string, unknown>;
  instructions?: string;
}

export type EraReply =
  | { result: Record<string, unknown> }
  | { error: { code: number; message: string; data?: unknown } }
  | null;

/** 新式请求在 params._meta 里声明的协议版本；老式请求返回 undefined。 */
export function requestedModernVersion(params: unknown): string | undefined {
  if (!isRecord(params) || !isRecord(params._meta)) return undefined;
  const version = params._meta[META_PROTOCOL_VERSION];
  return typeof version === "string" ? version : undefined;
}

export function isModernRequest(params: unknown): boolean {
  return requestedModernVersion(params) !== undefined;
}

/** initialize 握手：客户端要的老版本我们支持就原样回，否则回退到 DEFAULT_LEGACY_VERSION。 */
export function negotiateLegacyVersion(requested: unknown): string {
  return typeof requested === "string" && (LEGACY_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
    ? requested
    : DEFAULT_LEGACY_VERSION;
}

/** 各 server 在分派 tools/* 之前先问这里：返回非 null 就直接回给客户端。 */
export function preflightMcp(method: unknown, params: unknown, server: McpServerIdentity): EraReply {
  const capabilities = server.capabilities ?? { tools: {} };
  if (method === "initialize") {
    const requested = isRecord(params) ? params.protocolVersion : undefined;
    return {
      result: {
        protocolVersion: negotiateLegacyVersion(requested),
        capabilities,
        serverInfo: { name: server.name, version: server.version },
      },
    };
  }
  const modern = requestedModernVersion(params);
  if (modern !== undefined && !SUPPORTED_PROTOCOL_VERSIONS.includes(modern)) {
    return {
      error: {
        code: UNSUPPORTED_PROTOCOL_VERSION_CODE,
        message: "Unsupported protocol version",
        data: { supported: [...SUPPORTED_PROTOCOL_VERSIONS], requested: modern },
      },
    };
  }
  if (method === "server/discover") {
    return {
      result: {
        resultType: "complete",
        supportedVersions: [...SUPPORTED_PROTOCOL_VERSIONS],
        capabilities,
        _meta: { [META_SERVER_INFO]: { name: server.name, version: server.version } },
        ...(server.instructions ? { instructions: server.instructions } : {}),
        ...LIST_CACHE,
      },
    };
  }
  return null;
}

/** 2026-07-28 起每个 result 都必须带 resultType（"缺省即 complete" 只对老版本成立）；老式请求原样返回。 */
export function withResultType<T>(params: unknown, result: T): T {
  return isModernRequest(params) && isRecord(result) ? { ...result, resultType: "complete" } : result;
}

/** tools/list 结果：新式请求附 resultType 与缓存提示，老式请求原样返回（不给老客户端塞陌生字段）。 */
export function withListCache<T extends Record<string, unknown>>(params: unknown, result: T): T {
  return isModernRequest(params) ? { ...withResultType(params, result), ...LIST_CACHE } : result;
}

/** 把 preflight 的结论包成 JSON-RPC 响应对象（各 server 再按自己的响应类型断言）。 */
export function eraResponse(
  id: string | number | null,
  reply: Exclude<EraReply, null>,
): { jsonrpc: "2.0"; id: string | number | null } & Exclude<EraReply, null> {
  return { jsonrpc: "2.0", id, ...reply };
}
