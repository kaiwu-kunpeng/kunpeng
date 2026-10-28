import { isOnline, type Heartbeat } from "./presence.js";

export interface AgentSkill {
  id: string;
  name?: string;
  tags?: string[];
}

export interface AgentCard {
  name: string;
  online: boolean;
  lastSeen: number;
  skills: AgentSkill[];
  projectId?: string;
  worktree?: string;
  task?: string;
}

export function toAgentCard(
  hb: Heartbeat,
  opts: { now: number; windowMs?: number; skills?: AgentSkill[] },
): AgentCard {
  return {
    name: hb.instance,
    online: isOnline(hb.ts, opts.now, opts.windowMs),
    lastSeen: hb.ts,
    skills: opts.skills ?? [],
    ...(hb.projectId ? { projectId: hb.projectId } : {}),
    ...(hb.worktree ? { worktree: hb.worktree } : {}),
    ...(hb.task ? { task: hb.task } : {}),
  };
}

export function pickByCapability(
  cards: AgentCard[],
  skillId: string,
  opts?: { onlineOnly?: boolean },
): AgentCard[] {
  return cards.filter((card) => (
    (opts?.onlineOnly !== true || card.online) &&
    card.skills.some((skill) => skill.id === skillId || (skill.tags ?? []).includes(skillId))
  ));
}

export function cardsFromHeartbeats(heartbeats: Heartbeat[], opts: { now: number; windowMs?: number }): AgentCard[] {
  return heartbeats.map((hb) => toAgentCard(hb, {
    now: opts.now,
    windowMs: opts.windowMs,
    skills: (hb.skills ?? []).map((id) => ({ id })),
  }));
}

export function resolveSkills(opts: { env?: string; hasClaude?: boolean; hasCodex?: boolean }): string[] {
  const out = new Set<string>();
  for (const s of (opts.env ?? "").split(",").map((x) => x.trim()).filter(Boolean)) out.add(s);
  if (opts.hasClaude) out.add("claude");
  if (opts.hasCodex) out.add("codex");
  return [...out];
}
