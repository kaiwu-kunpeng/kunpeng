export interface ChannelSummary {
  channel: string;
  count: number;
  latestState?: string;
}

const CHANNEL_ORDER = ["ears", "official", "module", "security"];

export function summarizeChannels(items: { channel?: string; evidenceState?: string }[]): ChannelSummary[] {
  const grouped = new Map<string, ChannelSummary>();

  for (const item of items) {
    if (!item.channel) continue;

    const current = grouped.get(item.channel) ?? { channel: item.channel, count: 0 };
    current.count += 1;
    if (item.evidenceState !== undefined) current.latestState = item.evidenceState;
    grouped.set(item.channel, current);
  }

  return Array.from(grouped.values()).sort((a, b) => {
    const aIndex = CHANNEL_ORDER.indexOf(a.channel);
    const bIndex = CHANNEL_ORDER.indexOf(b.channel);
    const aKnown = aIndex !== -1;
    const bKnown = bIndex !== -1;
    if (aKnown && bKnown) return aIndex - bIndex;
    if (aKnown) return -1;
    if (bKnown) return 1;
    return a.channel.localeCompare(b.channel);
  });
}
