import { hoursToCapacity, willExceedWithin } from "./burn-rate.js";
import { flowUsdStageMix } from "../runtime/flow-cost.js";
import type { FlowState } from "../runtime/flowstate.js";

export interface BurnForecastInput {
  spentUsd: number;
  budgetUsd: number;
  elapsedHours: number;
}

export interface BurnForecast {
  ratePerHourUsd: number;
  remainingUsd: number;
  hoursToCapacity: number | null;
  exhausted: boolean;
}

function deriveRatePerHourUsd(input: BurnForecastInput): number {
  return input.elapsedHours > 0 ? input.spentUsd / input.elapsedHours : 0;
}

export function forecastBurn(input: BurnForecastInput): BurnForecast {
  const ratePerHourUsd = deriveRatePerHourUsd(input);
  const burnInput = {
    spentUsd: input.spentUsd,
    budgetUsd: input.budgetUsd,
    ratePerHourUsd,
  };

  return {
    ratePerHourUsd,
    remainingUsd: Math.max(0, input.budgetUsd - input.spentUsd),
    hoursToCapacity: hoursToCapacity(burnInput),
    exhausted: input.spentUsd >= input.budgetUsd,
  };
}

export function forecastBurnFromFlow(
  flow: Pick<FlowState, "tokensUsed" | "startedAt" | "updatedAt" | "backend" | "stageTokens" | "stageBackends" | "stageModels">,
  budgetUsd: number,
): BurnForecast {
  const spentUsd = flowUsdStageMix(flow);
  const elapsedHours = Math.max(0, (flow.updatedAt - flow.startedAt) / 3_600_000);

  return forecastBurn({ spentUsd, budgetUsd, elapsedHours });
}

export function willExhaustWithin(input: BurnForecastInput, horizonHours: number): boolean {
  return willExceedWithin(
    {
      spentUsd: input.spentUsd,
      budgetUsd: input.budgetUsd,
      ratePerHourUsd: deriveRatePerHourUsd(input),
    },
    horizonHours,
  );
}
