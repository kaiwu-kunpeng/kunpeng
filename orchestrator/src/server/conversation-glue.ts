import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { ConversationStore, type Conversation } from "../chat/conversation-store.js";
import { extractSearchedData } from "../chat/kb-extract.js";
import { CaptureStore, newCapture, resolveCapturesDir } from "../knowledge/capture-store.js";
import { heuristicSummarize } from "../knowledge/capture-cli.js";
import { kunpengStateDir } from "../project/registry.js";
import { readAuthConfig, writeAuthConfig } from "./auth.js";
import { resolveRepo } from "./project-scope.js";

export function conversationStore(opts: { repoRoot?: string; stateDir?: string }): ConversationStore {
  return new ConversationStore(join(opts.stateDir || kunpengStateDir(), "chat"), {
    now: () => Date.now(),
    id: () => `conv-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`,
  });
}

export async function migrateLegacyConversationOwners(
  stateDir: string,
  store: ConversationStore,
): Promise<void> {
  const config = await readAuthConfig(stateDir);
  if (!config) return;

  const pending = config.accounts.filter((account) => account.legacyConversationOwner !== undefined);
  for (const account of pending) {
    if (!account.id) throw new Error(`Legacy account ${account.username} is missing accountId`);
    await store.migrateOwner(account.legacyConversationOwner ?? "", account.id);
  }
  if (pending.length === 0) return;

  await writeAuthConfig(stateDir, {
    ...config,
    accounts: config.accounts.map((account) => {
      if (account.legacyConversationOwner === undefined) return account;
      const persisted = { ...account };
      delete persisted.legacyConversationOwner;
      return persisted;
    }),
  });
}

export async function captureConversationSearches(opts: { repoRoot?: string; stateDir?: string }, conversation: Conversation): Promise<void> {
  const items = extractSearchedData(conversation.turns);
  if (items.length === 0) return;

  const repoRoot = conversation.projectId ? await resolveRepo(opts, conversation.projectId) : opts.repoRoot ?? null;
  if (!repoRoot) {
    console.warn(`[conversation-endpoints] skip KB capture: unknown project ${conversation.projectId ?? "(none)"}`);
    return;
  }

  const store = new CaptureStore(resolveCapturesDir(repoRoot));
  const captures = items.map((item) => {
    const summary = heuristicSummarize(item.text);
    return newCapture(
      {
        source: "chat",
        kind: "text",
        raw: item.text,
        ...summary,
        projectId: conversation.projectId,
        citedFrom: item.citedFrom,
      },
      {
        now: () => Date.now(),
        id: () => `cap-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`,
      },
    );
  });

  const failures: Error[] = [];
  for (const capture of captures) {
    try {
      const appended = await store.appendCapture(capture);
      if (!appended) throw new Error(`Capture already exists: ${capture.id}`);
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      failures.push(failure);
      console.warn(`[conversation-endpoints] KB capture failed for ${capture.id}: ${failure.message}`);
    }
  }

  if (failures.length > 0) {
    throw new AggregateError(failures, `Failed to persist ${failures.length} conversation capture(s)`);
  }
}

export function parseConversationRoute(url: string): { id: string | null; restore: boolean } | null {
  const path = url.split("?")[0];
  if (path === "/api/conversations") return { id: null, restore: false };
  if (!path.startsWith("/api/conversations/")) return null;

  const rest = path.slice("/api/conversations/".length);
  if (rest === "") return null;
  const parts = rest.split("/");
  if (parts.length === 1) return { id: decodeURIComponent(parts[0]), restore: false };
  if (parts.length === 2 && parts[1] === "restore") {
    return { id: decodeURIComponent(parts[0]), restore: true };
  }
  return null;
}
