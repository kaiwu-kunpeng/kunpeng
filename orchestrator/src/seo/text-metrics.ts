const wordSegmenter = new Intl.Segmenter(undefined, { granularity: "word" });
const unspacedText = /[\p{Script_Extensions=Han}\p{Script_Extensions=Hiragana}\p{Script_Extensions=Katakana}\p{Script_Extensions=Thai}\p{Script_Extensions=Lao}\p{Script_Extensions=Khmer}\p{Script_Extensions=Myanmar}\u3000-\u303f\uff00-\uffef]+/gu;

export function countWords(text: string): number {
  let segmentedWords = 0;
  const spacedText = text.replace(unspacedText, (part) => {
    for (const segment of wordSegmenter.segment(part)) {
      if (segment.isWordLike === true) segmentedWords++;
    }
    // Preserve boundaries between the remaining whitespace-delimited words.
    return " ";
  });
  return segmentedWords + spacedText.split(/\s+/).filter(Boolean).length;
}
