import { existsSync } from "node:fs";
import { readFile as fsReadFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { findTmuxBin } from "../server/pty-tmux.js";

export interface PreflightItem {
  key: string;
  label: string;
  ok: boolean;
  hint: string;
}

export interface PreflightDeps {
  readFile?: (p: string) => Promise<string>;
  exists?: (p: string) => boolean;
  home?: string;
}

function safeExists(exists: (p: string) => boolean, path: string): boolean {
  try {
    return exists(path);
  } catch {
    return false;
  }
}

async function claudeAuthOk(readFile: (p: string) => Promise<string>, home: string): Promise<boolean> {
  try {
    const raw = await readFile(join(home, ".claude.json"));
    const parsed = JSON.parse(raw) as { oauthAccount?: { emailAddress?: unknown } };
    return typeof parsed.oauthAccount?.emailAddress === "string" && parsed.oauthAccount.emailAddress.trim().length > 0;
  } catch {
    return false;
  }
}

export async function collectPreflight(deps?: PreflightDeps): Promise<PreflightItem[]> {
  const readFile = deps?.readFile ?? ((p: string) => fsReadFile(p, "utf8"));
  const exists = deps?.exists ?? existsSync;
  const home = deps?.home ?? homedir();

  const claudeOk = await claudeAuthOk(readFile, home);
  const codexOk = safeExists(exists, join(home, ".codex", "auth.json"));
  const tmuxOk = findTmuxBin((path) => safeExists(exists, path)) !== null;

  return [
    { key: "claude-auth", label: "Claude CLI 登录", ok: claudeOk, hint: "终端运行 claude 后 /login" },
    { key: "codex-auth", label: "Codex CLI 登录", ok: codexOk, hint: "终端运行 codex login" },
    { key: "tmux", label: "tmux（终端会话复活）", ok: tmuxOk, hint: "brew install tmux" },
  ];
}

export function preflightAllOk(items: PreflightItem[]): boolean {
  return items.every((item) => item.ok);
}
