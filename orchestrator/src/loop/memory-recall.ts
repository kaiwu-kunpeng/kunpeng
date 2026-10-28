export interface RecallExperience {
  title?: string;
  body: string;
}

function tokenize(text: string): Set<string> {
  const tokens = new Set<string>();
  const chunks = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  for (const chunk of chunks) {
    const parts = chunk.match(/[\p{Script=Han}]+|[^\p{Script=Han}]+/gu) ?? [];
    for (const part of parts) {
      if (/^[\p{Script=Han}]+$/u.test(part)) {
        // 中文没有空格词界；二元切分既遵守最短两字符，也能稳定召回短语重叠。
        const chars = Array.from(part);
        if (chars.length >= 2) tokens.add(part);
        for (let i = 0; i + 1 < chars.length; i += 1) {
          tokens.add(chars[i] + chars[i + 1]);
        }
      } else if (Array.from(part).length >= 2) {
        tokens.add(part);
      }
    }
  }
  return tokens;
}

function overlapScore(left: Set<string>, right: Set<string>): number {
  let score = 0;
  for (const token of left) {
    if (right.has(token)) score += 1;
  }
  return score;
}

function flattenedBody(body: string): string {
  return body.replace(/\s+/gu, " ").trim().slice(0, 200);
}

/** 按需求词汇重叠召回经验。任何坏输入都 fail-soft 为空结果。 */
export function relevantExperiences(
  requirement: string,
  experiences: RecallExperience[],
  k = 3,
): string[] {
  try {
    if (typeof requirement !== "string" || !Array.isArray(experiences)) return [];
    if (!Number.isFinite(k) || k <= 0) return [];
    const requirementTokens = tokenize(requirement);
    if (requirementTokens.size === 0) return [];

    return experiences
      .map((experience, index) => {
        if (!experience || typeof experience.body !== "string") return null;
        const title = typeof experience.title === "string" ? experience.title.replace(/\s+/gu, " ").trim() : "";
        const score = overlapScore(requirementTokens, tokenize(`${title} ${experience.body}`));
        if (score === 0) return null;
        const body = flattenedBody(experience.body);
        const firstLine = (experience.body.split(/\r?\n/u).find((line) => line.trim()) ?? "").trim();
        return { score, index, text: `【经验】${title || firstLine}: ${body}` };
      })
      .filter((item): item is { score: number; index: number; text: string } => item !== null)
      .sort((left, right) => right.score - left.score || left.index - right.index)
      .slice(0, Math.floor(k))
      .map((item) => item.text);
  } catch {
    return [];
  }
}
