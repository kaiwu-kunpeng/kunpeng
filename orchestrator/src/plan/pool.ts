/** 并发池：同时最多 n 个任务，保结果顺序。纯控制，无 I/O。 */
export async function runPool<T, R>(items: T[], n: number, fn: (item: T, idx: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, n), items.length) }, () => worker()));
  return results;
}
