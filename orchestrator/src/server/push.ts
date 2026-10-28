import {
  createPrivateKey,
  createSign,
  generateKeyPairSync,
  type JsonWebKey,
} from "node:crypto";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { aggregateReviewQueue, collectMultiState } from "./state.js";
import { isNodeError } from "../util/errors.js";
import { loadNotifyConfig, notifyMergeGate, notifyText, type NotifyConfig } from "../runtime/notify.js";
import { phonePushCandidates } from "../runtime/phone-push-policy.js";
import { isActionLevel } from "../policy/action-levels.js";
import { issueImTicket } from "./im-approve.js";

export type PushNotificationKind = "done" | "error" | "gate";

export interface PushNotification {
  kind: PushNotificationKind;
  title: string;
  body: string;
  url: string;
  at?: number;
}

/** 每轮人工门扫描落一条：有没有候选、推了没、哪个通道失败——让「三天零推送」能区分「没事发生」和「通道坏了」。 */
export interface PhoneScanRecord {
  at: number;
  candidates: number;
  sent: string[];
  failed: string[];
  skipped?: "no-candidates" | "throttled" | "no-config";
  /** Telegram 直批按钮（notifyMergeGate）的发送结果，只对新出现的合并门发。 */
  buttons?: { sent: string[]; failed: string[] };
}

/** 每日一条通道心跳：首轮只落种子不发，满 24h 才真发，发送结果记在这里作为「通道可达」的正向证据。 */
export interface ChannelHeartbeatRecord {
  at: number;
  sent: string[];
  failed: string[];
  seeded?: true;
}

export const CHANNEL_HEARTBEAT_MS = 24 * 3600_000;

export interface PushSubscriptionRecord {
  endpoint: string;
  expirationTime?: number | null;
  keys?: Record<string, string>;
}

interface StoredVapidKeys {
  publicKey: JsonWebKey;
  privateKey: JsonWebKey;
}

let activeStateDir: string | undefined;
let vapidKeys: StoredVapidKeys | undefined;
let pendingWrites: Promise<void> = Promise.resolve();
let pendingDropped = 0;
let subscriptionWrites: Promise<void> = Promise.resolve();
let gateWatchTimer: NodeJS.Timeout | undefined;
let gateWatchRunning = false;
let gateWatchStopped = false;
let gateWatchInFlight: Promise<void> | undefined;
let gateWatchGeneration = 0;

function pushDir(stateDir = activeStateDir): string {
  if (!stateDir) throw new Error("Web Push 尚未初始化");
  return join(stateDir, "push");
}

function base64Url(value: Buffer | string): string {
  return Buffer.from(value).toString("base64url");
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return fallback;
    if (error instanceof SyntaxError) throw new Error(`Web Push 状态损坏: ${path}`, { cause: error });
    throw error;
  }
}

async function writeJson(
  path: string,
  value: unknown,
  mode = 0o600,
  shouldStillWrite?: () => boolean,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode });
  if (shouldStillWrite?.() === false) {
    await unlink(tmp).catch(() => undefined);
    return;
  }
  await rename(tmp, path);
  await chmod(path, mode);
}

function readDerLength(input: Buffer, offset: number): { length: number; next: number } {
  const first = input[offset];
  if (first === undefined) throw new Error("ECDSA DER 长度缺失");
  if ((first & 0x80) === 0) return { length: first, next: offset + 1 };
  const bytes = first & 0x7f;
  if (bytes === 0 || bytes > 4 || offset + 1 + bytes > input.length) {
    throw new Error("ECDSA DER 长度非法");
  }
  let length = 0;
  for (let index = 0; index < bytes; index += 1) {
    length = length * 256 + (input[offset + 1 + index] ?? 0);
  }
  if (length < 128) throw new Error("ECDSA DER 长度不是最短编码");
  return { length, next: offset + 1 + bytes };
}

function readDerInteger(input: Buffer, offset: number): { value: Buffer; next: number } {
  if (input[offset] !== 0x02) throw new Error("ECDSA DER 缺少 INTEGER");
  const parsed = readDerLength(input, offset + 1);
  const end = parsed.next + parsed.length;
  if (parsed.length === 0 || end > input.length) throw new Error("ECDSA DER INTEGER 越界");
  let value = input.subarray(parsed.next, end);
  if ((value[0] ?? 0) & 0x80) throw new Error("ECDSA DER INTEGER 为负数");
  if (value.length > 1 && value[0] === 0) {
    if (((value[1] ?? 0) & 0x80) === 0) throw new Error("ECDSA DER INTEGER 前导零非法");
    value = value.subarray(1);
  }
  if (value.length > 32) throw new Error("ECDSA DER INTEGER 超过 P-256 宽度");
  const padded = Buffer.alloc(32);
  value.copy(padded, 32 - value.length);
  return { value: padded, next: end };
}

/** 严格把 ASN.1 DER ECDSA 签名转换成 ES256 所需的 64 字节 JOSE 签名。 */
function derToJose(signature: Uint8Array): Buffer {
  const input = Buffer.from(signature);
  if (input[0] !== 0x30) throw new Error("ECDSA DER 缺少 SEQUENCE");
  const sequence = readDerLength(input, 1);
  if (sequence.next + sequence.length !== input.length) throw new Error("ECDSA DER SEQUENCE 长度不符");
  const r = readDerInteger(input, sequence.next);
  const s = readDerInteger(input, r.next);
  if (s.next !== input.length) throw new Error("ECDSA DER 含多余数据");
  return Buffer.concat([r.value, s.value]);
}

export async function ensureVapidKeys(stateDir: string): Promise<void> {
  activeStateDir = stateDir;
  const dir = join(stateDir, "push");
  const path = join(dir, "vapid.json");
  await mkdir(dir, { recursive: true });
  try {
    const stored = await readJson<StoredVapidKeys | null>(path, null);
    if (stored?.publicKey?.x && stored.publicKey.y && stored.privateKey?.d) {
      vapidKeys = stored;
      await chmod(path, 0o600);
      return;
    }
  } catch (error) {
    if (!(isNodeError(error) && error.code === "ENOENT")) throw error;
  }

  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const stored: StoredVapidKeys = {
    publicKey: publicKey.export({ format: "jwk" }),
    privateKey: privateKey.export({ format: "jwk" }),
  };
  vapidKeys = stored;
  await writeJson(path, stored, 0o600);
}

function currentKeys(): StoredVapidKeys {
  if (!vapidKeys) throw new Error("VAPID 密钥尚未初始化");
  return vapidKeys;
}

export function publicKeyB64Url(): string {
  const jwk = currentKeys().publicKey;
  if (!jwk.x || !jwk.y) throw new Error("VAPID 公钥缺少坐标");
  const x = Buffer.from(jwk.x, "base64url");
  const y = Buffer.from(jwk.y, "base64url");
  if (x.length !== 32 || y.length !== 32) throw new Error("VAPID 公钥坐标长度非法");
  return Buffer.concat([Buffer.from([0x04]), x, y]).toString("base64url");
}

export function signVapidJwt(audienceOrigin: string): string {
  const audience = new URL(audienceOrigin);
  if (audience.origin !== audienceOrigin || audience.protocol !== "https:") {
    throw new Error("VAPID audience 必须是 HTTPS origin");
  }
  const header = base64Url(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const payload = base64Url(JSON.stringify({
    aud: audienceOrigin,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: "mailto:kunpeng@local",
  }));
  const unsigned = `${header}.${payload}`;
  const signer = createSign("SHA256");
  signer.update(unsigned);
  signer.end();
  const der = signer.sign(createPrivateKey({ key: currentKeys().privateKey, format: "jwk" }));
  return `${unsigned}.${derToJose(der).toString("base64url")}`;
}

function normalizeSubscription(value: unknown): PushSubscriptionRecord {
  if (typeof value !== "object" || value === null) throw new Error("订阅格式非法");
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.endpoint !== "string" || candidate.endpoint.length > 4096) {
    throw new Error("订阅 endpoint 非法");
  }
  const endpoint = new URL(candidate.endpoint);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password) {
    throw new Error("订阅 endpoint 必须是无凭证 HTTPS URL");
  }
  const normalized: PushSubscriptionRecord = { endpoint: endpoint.href };
  if (candidate.expirationTime === null || typeof candidate.expirationTime === "number") {
    normalized.expirationTime = candidate.expirationTime;
  }
  if (typeof candidate.keys === "object" && candidate.keys !== null) {
    const keys: Record<string, string> = {};
    for (const [key, entry] of Object.entries(candidate.keys as Record<string, unknown>)) {
      if (typeof entry === "string" && entry.length <= 4096) keys[key] = entry;
    }
    normalized.keys = keys;
  }
  return normalized;
}

async function readSubscriptions(stateDir?: string): Promise<PushSubscriptionRecord[]> {
  const value = await readJson<unknown>(join(pushDir(stateDir), "subs.json"), []);
  if (!Array.isArray(value)) throw new Error("Web Push 订阅状态不是数组");
  return value.map(normalizeSubscription);
}

export async function addSubscription(value: unknown): Promise<boolean> {
  const subscription = normalizeSubscription(value);
  let added = false;
  const operation = subscriptionWrites.then(async () => {
    const subscriptions = await readSubscriptions();
    const index = subscriptions.findIndex((entry) => entry.endpoint === subscription.endpoint);
    if (index >= 0) subscriptions[index] = subscription;
    else {
      subscriptions.push(subscription);
      added = true;
    }
    await writeJson(join(pushDir(), "subs.json"), subscriptions);
  });
  subscriptionWrites = operation.catch(() => undefined);
  await operation;
  return added;
}

function endpointFrom(value: unknown): string {
  const raw = typeof value === "string"
    ? value
    : (typeof value === "object" && value !== null ? (value as Record<string, unknown>).endpoint : undefined);
  if (typeof raw !== "string") throw new Error("缺少订阅 endpoint");
  return new URL(raw).href;
}

async function removeSubscriptionFromStateDir(value: unknown, stateDir?: string): Promise<boolean> {
  const endpoint = endpointFrom(value);
  let removed = false;
  const operation = subscriptionWrites.then(async () => {
    const subscriptions = await readSubscriptions(stateDir);
    const next = subscriptions.filter((entry) => entry.endpoint !== endpoint);
    removed = next.length !== subscriptions.length;
    if (removed) await writeJson(join(pushDir(stateDir), "subs.json"), next);
  });
  subscriptionWrites = operation.catch(() => undefined);
  await operation;
  return removed;
}

export async function removeSubscription(value: unknown): Promise<boolean> {
  return removeSubscriptionFromStateDir(value);
}

export async function hasSubscriptions(): Promise<boolean> {
  if (!activeStateDir) return false;
  await subscriptionWrites;
  return (await readSubscriptions()).length > 0;
}

async function pushToAll(stateDir?: string): Promise<{ sent: number; failed: number; removed: number }> {
  await subscriptionWrites;
  const subscriptions = await readSubscriptions(stateDir);
  let sent = 0;
  let failed = 0;
  let removed = 0;
  await Promise.all(subscriptions.map(async (subscription) => {
    try {
      const endpoint = new URL(subscription.endpoint);
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `vapid t=${signVapidJwt(endpoint.origin)}, k=${publicKeyB64Url()}`,
          TTL: "60",
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (response.status === 404 || response.status === 410) {
        if (await removeSubscriptionFromStateDir(subscription.endpoint, stateDir)) removed += 1;
        return;
      }
      if (!response.ok) {
        failed += 1;
        return;
      }
      sent += 1;
    } catch {
      failed += 1;
    }
  }));
  return { sent, failed, removed };
}

async function notifyInStateDir(notification: PushNotification, stateDir?: string): Promise<void> {
  const entry: PushNotification = {
    kind: notification.kind,
    title: String(notification.title).slice(0, 120),
    body: String(notification.body).slice(0, 240),
    url: String(notification.url || "/").slice(0, 2048),
    at: Date.now(),
  };
  const operation = pendingWrites.then(async () => {
    const path = join(pushDir(stateDir), "pending.json");
    const pending = await readJson<PushNotification[]>(path, []);
    pending.push(entry);
    await writeJson(path, pending.slice(-20));
    const dropped = Math.max(0, pending.length - 20);
    if (dropped > 0) {
      pendingDropped += dropped;
      console.warn(`[web-push] 待取队列溢出，丢弃 ${dropped} 条，累计丢弃 ${pendingDropped} 条`);
    }
  });
  pendingWrites = operation.catch(() => undefined);
  await operation;
  await pushToAll(stateDir);
}

export async function notify(notification: PushNotification): Promise<void> {
  await notifyInStateDir(notification);
}

export function pushQueueDropped(): number {
  return pendingDropped;
}

export async function drainPending(): Promise<PushNotification[]> {
  let drained: PushNotification[] = [];
  const operation = pendingWrites.then(async () => {
    const path = join(pushDir(), "pending.json");
    drained = await readJson<PushNotification[]>(path, []);
    await writeJson(path, []);
  });
  pendingWrites = operation.catch(() => undefined);
  await operation;
  return drained;
}

async function scanGates(scanGeneration: number): Promise<void> {
  const stateDir = activeStateDir;
  if (gateWatchRunning || !stateDir) return;
  gateWatchRunning = true;
  try {
    const snapshots = await collectMultiState(stateDir);
    const gates = aggregateReviewQueue(snapshots);
    const path = join(pushDir(stateDir), "seen-gates.json");
    const seenList = await readJson<string[]>(path, []);
    const seen = new Set(seenList);
    const stillWriting = () => shouldWriteGateScan(scanGeneration, gateWatchGeneration, gateWatchStopped);
    const cfg = await loadNotifyConfig();
    if (!stillWriting()) return;
    const buttons = { sent: [] as string[], failed: [] as string[] };
    for (const gate of gates) {
      if (!stillWriting()) return;
      const id = `${gate.projectId}:${gate.kind}:${gate.id}`;
      if (seen.has(id)) continue;
      await notifyInStateDir({
        kind: "gate",
        title: `待审人工门: ${gate.title}`,
        body: `${gate.projectName}: ${gate.detail}`,
        url: "/#/inbox",
      }, stateDir);
      // Telegram 直批按钮只在 Telegram 配好时、对新出现的合并门发一次（其它通道仍走 30 分钟摘要，不重复）。
      if (gate.kind === "merge" && cfg?.telegram) {
        const tgOnly: NotifyConfig = { telegram: cfg.telegram, ...(cfg.cockpitUrl ? { cockpitUrl: cfg.cockpitUrl } : {}) };
        const level = isActionLevel(gate.decision?.blastRadius) ? gate.decision.blastRadius : "L2";
        const ticket = await issueImTicket(stateDir, { flowId: gate.id, level });
        const result = await notifyMergeGate(gate.id, gate.title, tgOnly, undefined, { ticket: ticket.id, level });
        buttons.sent.push(...result.sent);
        buttons.failed.push(...result.failed);
      }
      seen.add(id);
    }
    if (!stillWriting()) return;
    const now = Date.now();
    const candidates = phonePushCandidates(snapshots, now).filter(({ key }) => !seen.has(`phone:${key}`));
    const scan: PhoneScanRecord = { at: now, candidates: candidates.length, sent: [], failed: [] };
    if (buttons.sent.length > 0 || buttons.failed.length > 0) scan.buttons = buttons;
    if (candidates.length === 0) {
      scan.skipped = "no-candidates";
    } else if (!cfg) {
      scan.skipped = "no-config";
    } else {
      try {
        const lastPath = join(pushDir(stateDir), "phone-last.json");
        let lastAt: number | undefined;
        try {
          const last = JSON.parse(await readFile(lastPath, "utf8")) as { at?: unknown } | null;
          if (typeof last?.at === "number" && Number.isFinite(last.at)) lastAt = last.at;
        } catch (error) {
          if (!(isNodeError(error) && error.code === "ENOENT") && !(error instanceof SyntaxError)) throw error;
        }
        if (!stillWriting()) return;
        if (lastAt !== undefined && now - lastAt < 30 * 60_000) {
          scan.skipped = "throttled";
        } else {
          const lines = (candidates.length > 8 ? candidates.slice(0, 7) : candidates).map(({ line }) => line);
          if (candidates.length > 8) lines.push(`…另有 ${candidates.length - 7} 条`);
          if (!stillWriting()) return;
          const { sent, failed } = await notifyText("🔔 鲲鹏 · 需要你处理", lines.join("\n"), cfg);
          scan.sent = sent;
          scan.failed = failed;
          if (!stillWriting()) return;
          if (sent.length > 0) {
            for (const { key } of candidates) seen.add(`phone:${key}`);
            if (!stillWriting()) return;
            await writeJson(lastPath, { at: Date.now() }, 0o600, stillWriting);
            if (!stillWriting()) return;
          } else {
            console.warn("[通知] 手机摘要推送失败: 没有成功发送的通道");
          }
        }
      } catch (error) {
        console.warn(`[通知] 手机摘要推送失败: ${String(error).slice(0, 120)}`);
      }
    }
    if (!stillWriting()) return;
    await writeJson(join(pushDir(stateDir), "phone-scan.json"), scan, 0o600, stillWriting);
    if (!stillWriting()) return;
    await channelHeartbeat(stateDir, cfg, now, stillWriting);
    if (!stillWriting()) return;
    await writeJson(path, [...seen].slice(-2000), 0o600, stillWriting);
  } finally {
    gateWatchRunning = false;
  }
}

/** 每日通道心跳：没有种子就只落种子（首轮不发，免得测试 / 新装机一起就推）；满 24h 才发一条并记结果。 */
async function channelHeartbeat(stateDir: string, cfg: NotifyConfig | null, now: number, stillWriting: () => boolean): Promise<void> {
  if (!cfg) return;
  const hbPath = join(pushDir(stateDir), "channel-heartbeat.json");
  const last = await readJson<ChannelHeartbeatRecord | null>(hbPath, null);
  if (!stillWriting()) return;
  if (last === null || typeof last.at !== "number") {
    await writeJson(hbPath, { at: now, sent: [], failed: [], seeded: true } satisfies ChannelHeartbeatRecord, 0o600, stillWriting);
    return;
  }
  if (now - last.at < CHANNEL_HEARTBEAT_MS) return;
  try {
    const { sent, failed } = await notifyText("🫀 鲲鹏 · 通知通道心跳", `serve 在线，${new Date(now).toLocaleString("zh-CN")}。每日一条，用于证明通道可达。`, cfg);
    if (!stillWriting()) return;
    await writeJson(hbPath, { at: now, sent, failed } satisfies ChannelHeartbeatRecord, 0o600, stillWriting);
    if (sent.length === 0) console.warn("[通知] 通道心跳推送失败: 没有成功发送的通道");
  } catch (error) {
    console.warn(`[通知] 通道心跳推送失败: ${String(error).slice(0, 120)}`);
  }
}

export function shouldReportGateScanError(stopped: boolean): boolean {
  return !stopped;
}

export function shouldWriteGateScan(scanGeneration: number, currentGeneration: number, stopped: boolean): boolean {
  return scanGeneration === currentGeneration && !stopped;
}

export function currentGateWatchGeneration(): number {
  return gateWatchGeneration;
}

function runGateScan(errorMessage: string): void {
  const wasRunning = gateWatchRunning;
  const scanGeneration = gateWatchGeneration;
  const scan = scanGates(scanGeneration);
  if (!wasRunning) gateWatchInFlight = scan;
  void scan.catch((error: unknown) => {
    if (shouldReportGateScanError(gateWatchStopped)) console.error(errorMessage, error);
  }).finally(() => {
    if (gateWatchInFlight === scan) gateWatchInFlight = undefined;
  });
}

export async function awaitGateWatchIdle(): Promise<void> {
  await gateWatchInFlight?.catch(() => undefined);
}

export function startGateWatch(intervalMs: number): () => Promise<void> {
  if (!Number.isFinite(intervalMs) || intervalMs < 1000) throw new Error("人工门轮询间隔至少 1000ms");
  if (gateWatchTimer) clearInterval(gateWatchTimer);
  gateWatchStopped = false;
  gateWatchGeneration += 1;
  runGateScan("[web-push] 首次人工门扫描失败");
  gateWatchTimer = setInterval(() => {
    runGateScan("[web-push] 人工门扫描失败");
  }, intervalMs);
  gateWatchTimer.unref();
  return async () => {
    gateWatchStopped = true;
    if (gateWatchTimer) clearInterval(gateWatchTimer);
    gateWatchTimer = undefined;
    await gateWatchInFlight?.catch(() => undefined);
  };
}
