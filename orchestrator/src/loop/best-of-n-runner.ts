import { type Candidate, type SelectionResult, selectBestCandidate } from "./best-of-n.js";

export interface SharedSpec {
  text: string;
  meta?: Record<string, unknown>;
}

export interface BestOfNDeps {
  n: number;
  /** 方向6 省 token：提供时在 fan-out【前只调用一次】，结果作为 sharedSpec 透传给每个 runCandidate，
   *  让 N 候选共享同一份 spec，省 (N-1)× spec token。缺省时不调用、candidate 收到 undefined（行为不变）。 */
  runSpecOnce?: () => Promise<SharedSpec>;
  runCandidate: (index: number, sharedSpec?: SharedSpec) => Promise<Candidate>;
}

export interface BestOfNResult extends SelectionResult {
  candidates: Candidate[];
  n: number;
}

export async function runBestOfN(deps: BestOfNDeps): Promise<BestOfNResult> {
  const n = Math.max(0, deps.n);

  if (n === 0) {
    return {
      winner: null,
      ranking: [],
      reason: "n<=0 无候选",
      candidates: [],
      n,
    };
  }

  const sharedSpec = deps.runSpecOnce ? await deps.runSpecOnce() : undefined;

  const candidates = await Promise.all(
    Array.from({ length: n }, async (_, index) => {
      try {
        return await deps.runCandidate(index, sharedSpec);
      } catch {
        return { id: `cand-${index}`, passed: false, ms: 0 };
      }
    }),
  );
  const sel = selectBestCandidate(candidates);

  return { ...sel, candidates, n };
}
