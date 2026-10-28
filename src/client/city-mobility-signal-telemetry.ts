import type { CityMobilitySignal } from "./city-mobility";

type SignalState = Pick<CityMobilitySignal, "id" | "horizontal" | "vertical" | "pedestrians">;
export const CITY_MOBILITY_SIGNAL_STATE_ENCODING = "sparse-red-default-v1";

/** Every omitted canonical zone is RRR. Zone IDs already use coordinate
 * bounds (including colons), so the final colon separates its three colors. */
export function encodeCityMobilitySignalState(signals: readonly SignalState[]): string {
  let value = `zones=${signals.length}`;
  for (const signal of signals) {
    if (signal.horizontal === "RED" && signal.vertical === "RED" && signal.pedestrians === "RED") continue;
    value += `;${signal.id}:${signal.horizontal[0]}${signal.vertical[0]}${signal.pedestrians[0]}`;
  }
  return value;
}
