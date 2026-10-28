export interface Candidate {
  id: string;
  passed: boolean;
  ms: number;
  cost?: number;
  score?: number;
}

export interface SelectionResult {
  winner: Candidate | null;
  ranking: Candidate[];
  reason: string;
}

export const MS_TIE_TOLERANCE = 0.2;

export function msWithinTolerance(
  left: number,
  right: number,
  tolerance = MS_TIE_TOLERANCE,
): boolean {
  return Math.abs(left - right) <= tolerance * Math.min(left, right);
}

interface IndexedCandidate {
  candidate: Candidate;
  index: number;
}

function comparableScore(candidate: Candidate): number {
  return candidate.score ?? Number.NEGATIVE_INFINITY;
}

function comparableCost(candidate: Candidate): number {
  return candidate.cost ?? Infinity;
}

function compareDescending(left: number, right: number): number {
  if (left > right) {
    return -1;
  }
  if (left < right) {
    return 1;
  }
  return 0;
}

function compareAscending(left: number, right: number): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function compareCandidates(left: IndexedCandidate, right: IndexedCandidate): number {
  if (left.candidate.passed !== right.candidate.passed) {
    return left.candidate.passed ? -1 : 1;
  }

  const scoreCompare = compareDescending(comparableScore(left.candidate), comparableScore(right.candidate));
  if (scoreCompare !== 0) {
    return scoreCompare;
  }

  if (!msWithinTolerance(left.candidate.ms, right.candidate.ms)) {
    const msCompare = compareAscending(left.candidate.ms, right.candidate.ms);
    if (msCompare !== 0) {
      return msCompare;
    }
  }

  const costCompare = compareAscending(comparableCost(left.candidate), comparableCost(right.candidate));
  if (costCompare !== 0) {
    return costCompare;
  }

  return left.index - right.index;
}

function buildWinnerReason(winner: Candidate, ranking: Candidate[]): string {
  const passedCandidates = ranking.filter((candidate) => candidate.passed);
  const maxScore = Math.max(...passedCandidates.map(comparableScore));
  const minMs = Math.min(...passedCandidates.map((candidate) => candidate.ms));
  const minCost = Math.min(...passedCandidates.map(comparableCost));
  const advantages = [];

  if (comparableScore(winner) === maxScore && winner.score !== undefined) {
    advantages.push("最高分");
  }
  if (winner.ms === minMs) {
    advantages.push("最快");
  }
  if (comparableCost(winner) === minCost && Number.isFinite(comparableCost(winner))) {
    advantages.push("最省");
  }

  const advantageText = advantages.length > 0 ? advantages.join("、") : "排序最优";
  return `选择 ${winner.id}：已通过验收，且在通过候选中${advantageText}`;
}

export function selectBestCandidate(candidates: Candidate[]): SelectionResult {
  if (candidates.length === 0) {
    return { winner: null, ranking: [], reason: "无候选" };
  }

  const ranking = candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort(compareCandidates)
    .map(({ candidate }) => candidate);
  const winner = ranking.find((candidate) => candidate.passed) ?? null;

  if (winner === null) {
    return {
      winner: null,
      ranking,
      reason: `${candidates.length} 个候选无一通过验收`,
    };
  }

  return {
    winner,
    ranking,
    reason: buildWinnerReason(winner, ranking),
  };
}
