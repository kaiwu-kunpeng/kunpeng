export interface DistillSourceCard {
  raw?: string;
  summary?: string;
  distill?: string;
}

export function selectDistillSource(card: DistillSourceCard, nextLevel: number): string {
  if (nextLevel <= 1) {
    return card.raw || card.summary || "";
  }

  return card.distill || card.summary || card.raw || "";
}
