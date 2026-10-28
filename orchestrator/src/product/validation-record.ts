/**
 * 录入信号→裁定→闭环动作的纯封装。
 * 复用 validateProduct(真信号门) + closeValidationLoop(decision→action)。
 * 无 IO。
 */
import { validateProduct } from "./stages.js";
import { closeValidationLoop } from "./loop-close.js";
import type {
  ProductValidation,
  ProductIteration,
  ProductValidationSignal,
  ProductValidationDecision,
  ShapedPitch,
} from "./contract.js";

export function recordValidation(input: {
  pitch: ShapedPitch;
  hypotheses: string[];
  signals: ProductValidationSignal[];
  decision?: ProductValidationDecision;
  rationale?: string;
}): { validation: ProductValidation; iteration: ProductIteration } {
  const validation = validateProduct(input);
  const iteration = closeValidationLoop(validation, input.pitch);
  return { validation, iteration };
}
