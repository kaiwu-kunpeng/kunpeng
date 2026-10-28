// 纯函数、确定性的视觉差分判定（宪法 C8：能确定性判定的不调 LLM）。
// 上游负责像素比对并产出 diffPixels / totalPixels；本单元只负责判定。

const DEFAULT_MAX_DIFF_RATIO = 0.001; // 0.1%，抵抗抗锯齿噪声

export function decideVisual(
  diffPixels: number,
  totalPixels: number,
  opts?: { maxDiffRatio?: number },
): { ratio: number; withinTolerance: boolean } {
  const ratio = totalPixels > 0 ? diffPixels / totalPixels : 0; // 防除零：无像素时比例为 0
  const maxDiffRatio = opts?.maxDiffRatio ?? DEFAULT_MAX_DIFF_RATIO;
  return { ratio, withinTolerance: ratio <= maxDiffRatio };
}
