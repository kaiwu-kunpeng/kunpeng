export interface FailureRecord { category: string; outcome: string; context: string; }
export interface FailurePattern { category: string; count: number; examples: string[]; }
export interface LearningDigest { totalFailures: number; patterns: FailurePattern[]; directions: string[]; }

const FAILURE_RE = /rolled-back|rolled_back|failed|must-fix|must_fix|reject|越界|回滚/i;

export function summarizeFailures(records: FailureRecord[]): LearningDigest {
  const failures = records.filter((r) => FAILURE_RE.test(r.outcome));
  const byCat = new Map<string, FailureRecord[]>();
  for (const f of failures) {
    const key = f.category.trim() || "未分类";
    const list = byCat.get(key) ?? [];
    list.push(f);
    byCat.set(key, list);
  }
  const patterns: FailurePattern[] = [...byCat.entries()]
    .map(([category, rs]) => ({ category, count: rs.length, examples: rs.slice(0, 3).map((r) => r.context) }))
    .sort((a, b) => b.count - a.count);
  const directions = patterns
    .filter((p) => p.count >= 2)
    .map((p) => `高频失败类「${p.category}」(${p.count} 次)→ 应针对性加约束/检查/骨架`);
  return { totalFailures: failures.length, patterns, directions };
}
