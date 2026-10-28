import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestAuthContext {
  accountId?: string;
  profileId?: string;
  username?: string;
  role?: "owner" | "member";
}

export const requestAuthContext = new AsyncLocalStorage<RequestAuthContext>();

export function currentProfileId(): string | undefined {
  return requestAuthContext.getStore()?.profileId;
}

export function currentAccountId(): string | undefined {
  return requestAuthContext.getStore()?.accountId;
}

export function currentConversationOwner(): string {
  const context = requestAuthContext.getStore();
  if (!context) return "local";
  if (!context.accountId) throw new Error("Authenticated request context is missing accountId");
  return context.accountId;
}

export function currentUsername(): string {
  return requestAuthContext.getStore()?.username ?? "local";
}
