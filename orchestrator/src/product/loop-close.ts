import type { ProductIteration, ProductValidation, ShapedPitch } from "./contract.js";

export function closeValidationLoop(
  validation: ProductValidation,
  pitch: ShapedPitch,
): ProductIteration {
  if (validation.decision === "persevere") {
    return {
      fromDecision: validation.decision,
      action: "build",
      rationale: `验证通过(persevere)：可进入构建——${pitch.title}`,
      requiresHumanGate: validation.requiresHumanGate,
    };
  }

  if (validation.decision === "pivot") {
    return {
      fromDecision: validation.decision,
      action: "pivot",
      nextSeed: `基于「${pitch.problem}」转向：${validation.rationale || "重新定义问题或目标用户"}`,
      rationale: `验证判定 pivot：${validation.rationale || "假设被证伪，需转向"}`,
      requiresHumanGate: true,
    };
  }

  return {
    fromDecision: validation.decision,
    action: "gather-signals",
    rationale: validation.rationale || "缺真实信号，无法裁定；需采集遥测/真实访谈/销售信号",
    requiresHumanGate: true,
  };
}

/** 把 VALIDATE 闭环结果转成一条 ADR 内容(产品决策日志)。
 *  inconclusive(无真实裁定)→ null,不建 ADR(避免噪声);pivot/persevere → 填好五要素内容。纯函数。
 */
export function validationAdrSections(
  validation: ProductValidation,
  iteration: ProductIteration,
  pitch: ShapedPitch,
): { title: string; status: string; context: string; decision: string; consequences: string } | null {
  if (validation.decision === "inconclusive") return null;
  const title = `产品验证裁定：${validation.decision} —— ${pitch.title}`;
  const synthetic = validation.signals.some((s) => s.synthetic) ? "（含合成信号）" : "";
  const context = `针对 pitch「${pitch.title}」做验证。假设：${validation.hypotheses.join("；") || "(未列)"}。信号 ${validation.signals.length} 条${synthetic}。`;
  const decision = `裁定 ${validation.decision}：${validation.rationale}。下一步：${iteration.action}${iteration.nextSeed ? `（种子：${iteration.nextSeed}）` : ""}。`;
  const consequences = validation.decision === "persevere"
    ? "进入构建（BUILD = dev-cycle）。"
    : "转向（pivot）：放弃当前解法方向，按种子重新定义问题/目标用户，需人工确认。";
  return { title, status: "Accepted", context, decision, consequences };
}
