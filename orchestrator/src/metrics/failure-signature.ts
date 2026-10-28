export interface FailureItem {
  id: string;
  reason: string;
  at?: number;
}

export interface FailureCluster {
  signature: string;
  count: number;
  ids: string[];
  sample: string;
}

const ISO_TIMESTAMP = /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/g;
const PLAN_ID = /plan-[a-z0-9-]+/g;
const KP_ID = /kp\/[^\s]+/g;
const USERS_PATH = /\/Users\/[^\s]+\/(?=[^\s/]+)/g;
const LINE_COLUMN = /:\d+:\d+/g;
const LONG_NUMBER = /\d{3,}/g;

export function failureSignature(raw: string): string {
  return raw
    .replace(ISO_TIMESTAMP, "")
    .replace(PLAN_ID, "")
    .replace(KP_ID, "")
    .replace(USERS_PATH, "<path>/")
    .replace(LINE_COLUMN, ":N:N")
    .replace(LONG_NUMBER, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

export function clusterFailures(items: FailureItem[]): FailureCluster[] {
  const groups = new Map<string, FailureCluster & { firstSeen: number }>();

  items.forEach((item, index) => {
    const signature = failureSignature(item.reason);
    const existing = groups.get(signature);
    if (existing) {
      existing.count += 1;
      existing.ids.push(item.id);
      return;
    }

    groups.set(signature, {
      signature,
      count: 1,
      ids: [item.id],
      sample: item.reason,
      firstSeen: index,
    });
  });

  return [...groups.values()]
    .sort((left, right) => right.count - left.count || left.firstSeen - right.firstSeen)
    .map(({ firstSeen: _firstSeen, ...group }) => group);
}
