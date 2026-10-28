import {
  ruleOfTwo,
  type ActionContext,
  type RuleOfTwoVerdict,
} from "./rule-of-two.js";
import type { ArtifactStore } from "../artifacts/store.js";

export interface ConnectorActionInput {
  id: string;
  name: string;
  ctx: ActionContext;
}

export interface ConnectorGateResult {
  verdict: RuleOfTwoVerdict;
  gated: boolean;
  artifactId?: string;
}

export interface ConnectorAction {
  name: string;
  ctx: ActionContext;
  target?: string;
}

export interface ConnectorGateItem {
  action: string;
  target?: string;
  verdict: RuleOfTwoVerdict;
  requiresHumanGate: boolean;
  summary: string;
}

export function classifyConnectorAction(action: ConnectorAction): ConnectorGateItem {
  const verdict = ruleOfTwo(action.ctx);
  const targetSummary = action.target ? ` -> ${action.target}` : "";

  return {
    action: action.name,
    target: action.target,
    verdict,
    requiresHumanGate: verdict.requiresHumanGate,
    summary: `${action.name}${targetSummary}: ${verdict.reason}`,
  };
}

export function highRiskConnectorGates(actions: ConnectorAction[]): ConnectorGateItem[] {
  return actions.map(classifyConnectorAction).filter((item) => item.requiresHumanGate);
}

export async function proposeConnectorAction(
  store: ArtifactStore,
  input: ConnectorActionInput,
): Promise<ConnectorGateResult> {
  const verdict = ruleOfTwo(input.ctx);

  if (!verdict.requiresHumanGate) {
    return { verdict, gated: false };
  }

  await store.write({
    kind: "connector",
    id: input.id,
    status: "draft",
    body: `connector 动作：${input.name}\n${verdict.reason}`,
    meta: {
      verdict,
      ctx: input.ctx,
      name: input.name,
    },
  });

  return { verdict, gated: true, artifactId: input.id };
}
