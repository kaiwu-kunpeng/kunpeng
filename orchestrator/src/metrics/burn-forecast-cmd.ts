import { forecastBurn } from "./burn-forecast.js";

export function runBurnForecast(spentUsd: number, budgetUsd: number, elapsedHours: number): number {
  const forecast = forecastBurn({ spentUsd, budgetUsd, elapsedHours });
  const hoursToCapacity = forecast.hoursToCapacity === null ? "∞" : String(forecast.hoursToCapacity);

  console.log(
    `ratePerHourUsd=${forecast.ratePerHourUsd} remainingUsd=${forecast.remainingUsd} hoursToCapacity=${hoursToCapacity} exhausted=${forecast.exhausted}`,
  );

  return 0;
}
