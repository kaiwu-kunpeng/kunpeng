// HTTP 请求体读取工具（从 http.ts 巨石析出：给各路由与端点共享，避免路由文件反向依赖 http.ts）。
import type { IncomingMessage } from "node:http";

export type LimitedJsonBody = { ok: true; body: Record<string, unknown> } | { ok: false; status: 413 };

const DEFAULT_MAX_BODY_BYTES = 32 * 1024 * 1024;
export const UPLOAD_MAX_BODY_BYTES = 96 * 1024 * 1024;

export async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const result = await readLimitedJsonBody(req, DEFAULT_MAX_BODY_BYTES);
  return result.ok ? result.body : {};
}

export async function readRawBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export async function readLimitedJsonBody(req: IncomingMessage, maxBytes: number): Promise<LimitedJsonBody> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let done = false;

    const finish = (result: LimitedJsonBody) => {
      if (done) return;
      done = true;
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("error", onError);
      resolve(result);
    };

    const onData = (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        finish({ ok: false, status: 413 });
        req.resume();
        return;
      }
      chunks.push(chunk);
    };

    const onEnd = () => {
      try {
        finish({ ok: true, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
      } catch {
        finish({ ok: true, body: {} });
      }
    };

    const onError = () => finish({ ok: true, body: {} });

    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
  });
}

/** 严格读 JSON 对象体：超过 maxBytes 抛「请求体过大」并断开连接；不是合法 JSON 对象就抛错（调用方负责回 400）。 */
export async function readJsonObjectStrict(req: IncomingMessage, maxBytes = 64 * 1024): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("请求体过大"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("JSON 对象格式非法");
        resolve(parsed as Record<string, unknown>);
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}
