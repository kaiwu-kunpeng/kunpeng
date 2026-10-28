import { validateBrief, formatBriefMd, type DesignBrief, type GateResult } from "./brief-gate.js";
import { brandContextMd, brandVoiceDirective, type BrandContext } from "./brand-stage.js";
import { buildScale, buildSemantic, toDTCG } from "./color-engine.js";
import { getAnchor, describeAnchor } from "./design-anchors.js";
import { composeDesignSystemPrompt } from "./design-prompt.js";
import { lintDesign, type LintReport } from "./design-lint.js";
import { rankAnchors, type DesignDecision } from "./design-memory.js";

export interface DesignLoopInput {
  brief: Partial<DesignBrief>;
  seedHex: string;
  baseline: string;
  anchors?: string[];
  bucket?: string;
  history?: DesignDecision[];
  brand?: BrandContext;
}

export interface DesignLoopPlan {
  ok: boolean;
  gate: GateResult;
  briefMd?: string;
  chosenAnchor?: string;
  chosenFonts?: { display: string; body: string; mono?: string };
  rankedAnchors?: string[];
  tokens?: Record<string, unknown>;
  systemPrompt?: string;
  brandName?: string;
}

export function planDesign(input: DesignLoopInput): DesignLoopPlan {
  const gate = validateBrief(input.brief);
  if (!gate.ok) {
    return { ok: false, gate };
  }

  const rankedAnchors = input.anchors
    ? rankAnchors(input.history ?? [], input.bucket ?? "", input.anchors)
    : undefined;
  const scale = buildScale(input.seedHex);
  const semantic = buildSemantic(scale);
  const tokens = toDTCG(semantic);
  const briefMd = formatBriefMd(input.brief as DesignBrief);
  const chosenAnchor = rankedAnchors?.[0];
  const anchorObj = chosenAnchor ? getAnchor(chosenAnchor) : undefined;
  const anchorText = anchorObj ? describeAnchor(anchorObj) : chosenAnchor;
  const referenceParts = [input.brief.referenceUrl, input.brief.referenceNotes].filter(
    (part): part is string => typeof part === "string" && part.trim().length > 0,
  );
  const reference = referenceParts.length > 0 ? `参考: ${referenceParts.join(" · ")}` : undefined;
  const brandText = input.brand
    ? `${brandContextMd(input.brand)}\n\n${brandVoiceDirective(input.brand)}`
    : undefined;
  const systemPrompt = composeDesignSystemPrompt({
    baseline: input.baseline,
    ...(brandText ? { brand: brandText } : {}),
    brief: briefMd,
    anchor: anchorText,
    ...(reference ? { reference } : {}),
  });

  return {
    ok: true,
    gate,
    briefMd,
    chosenAnchor,
    chosenFonts: anchorObj?.fontPair,
    rankedAnchors,
    tokens,
    systemPrompt,
    brandName: input.brand?.name,
  };
}

export interface DesignGateResult {
  pass: boolean;
  lint: LintReport;
}

export function gateDesign(code: { css?: string; html?: string }): DesignGateResult {
  const lint = lintDesign(code);
  return { pass: lint.counts.P0 === 0, lint };
}
