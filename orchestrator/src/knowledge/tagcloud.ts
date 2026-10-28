import type { Capture } from "./capture-store.js";

export interface TagCloudEntry {
  tag: string;
  count: number;
  category?: string;
  level: number;
}

interface TagCount {
  tag: string;
  count: number;
  category?: string;
}

export function tagLevel(count: number, fMin: number, fMax: number): number {
  if (fMax <= fMin) return 3;
  const r = (Math.log(count) - Math.log(fMin)) / (Math.log(fMax) - Math.log(fMin));
  return Math.max(1, Math.min(5, Math.ceil(r * 5)));
}

export function buildTagCloud(
  captures: Capture[],
  limit = 40,
): { tags: TagCloudEntry[]; fMin: number; fMax: number } {
  const counts = new Map<string, number>();
  const catVotes = new Map<string, Map<string, number>>();

  for (const capture of captures) {
    const cat = capture.category;
    for (const raw of capture.tags ?? []) {
      const tag = String(raw).trim();
      if (tag.length < 2) continue;

      counts.set(tag, (counts.get(tag) ?? 0) + 1);
      if (cat) {
        const votes = catVotes.get(tag) ?? new Map<string, number>();
        votes.set(cat, (votes.get(cat) ?? 0) + 1);
        catVotes.set(tag, votes);
      }
    }
  }

  const all: TagCount[] = [...counts.entries()].map(([tag, count]) => {
    const votes = catVotes.get(tag);
    let category: string | undefined;
    if (votes) {
      let best = -1;
      for (const [candidate, voteCount] of votes) {
        if (voteCount > best) {
          best = voteCount;
          category = candidate;
        }
      }
    }
    return category ? { tag, count, category } : { tag, count };
  });

  const top = all
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .slice(0, limit);

  const fMin = top.length ? Math.min(...top.map((item) => item.count)) : 0;
  const fMax = top.length ? Math.max(...top.map((item) => item.count)) : 0;
  const tags = top
    .map((item) => ({ ...item, level: tagLevel(item.count, fMin, fMax) }))
    .sort((a, b) => a.tag.localeCompare(b.tag, "zh"));

  return { tags, fMin, fMax };
}
