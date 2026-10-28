import { describe, expect, it } from "vitest";
import { CITY_MOBILITY_SIGNAL_STATE_ENCODING, encodeCityMobilitySignalState } from "../src/client/city-mobility-signal-telemetry";

const red = (id: string) => ({ id, horizontal: "RED", vertical: "RED", pedestrians: "RED" } as const);

describe("lossless sparse signal diagnostics", () => {
  it("bounds a 50000-zone city diagnostic by its active colors", () => {
    const signals = Array.from({ length: 50_000 }, (_, n) => red(`${n},0:${n},1`));
    const live = [...signals, { ...red("-5,0:0,5"), vertical: "GREEN" as const }];
    const value = encodeCityMobilitySignalState(live);
    expect(value.length).toBeLessThan(1024);
    expect(value).toBe("zones=50001;-5,0:0,5:RGR");
    expect(CITY_MOBILITY_SIGNAL_STATE_ENCODING).toBe("sparse-red-default-v1");
  });

  it("keeps exact global order/colors and all-red defaults without mutating the source", () => {
    const signals = Object.freeze([Object.freeze(red("quiet")), Object.freeze({ ...red("north:1"), horizontal: "GREEN" as const }),
      Object.freeze({ ...red("south:2"), pedestrians: "GREEN" as const }), Object.freeze({ ...red("west:3"), vertical: "GREEN" as const })]);
    const before = JSON.stringify(signals), value = encodeCityMobilitySignalState(signals);
    expect(value).toBe("zones=4;north:1:GRR;south:2:RRG;west:3:RGR");
    const [total, ...active] = value.split(";"); expect(total).toBe(`zones=${signals.length}`);
    const decoded = new Map(signals.map(signal => [signal.id, "RRR"]));
    for (const item of active) {
      const separator = item.lastIndexOf(":"); decoded.set(item.slice(0, separator), item.slice(separator + 1));
    }
    expect([...decoded]).toEqual(signals.map(signal => [signal.id, `${signal.horizontal[0]}${signal.vertical[0]}${signal.pedestrians[0]}`]));
    expect(JSON.stringify(signals)).toBe(before);
  });

  it("represents every color combination and changes when a light or topology changes", () => {
    expect(encodeCityMobilitySignalState([])).toBe("zones=0");
    expect(encodeCityMobilitySignalState([red("a"), red("b")])).toBe("zones=2");
    for (let mask = 1; mask < 8; mask++) {
      const horizontal = mask & 1 ? "GREEN" : "RED", vertical = mask & 2 ? "GREEN" : "RED", pedestrians = mask & 4 ? "GREEN" : "RED";
      expect(encodeCityMobilitySignalState([{ id: "a", horizontal, vertical, pedestrians }, red("b")]))
        .toBe(`zones=2;a:${horizontal[0]}${vertical[0]}${pedestrians[0]}`);
    }
    expect(encodeCityMobilitySignalState([red("a")])).not.toBe(encodeCityMobilitySignalState([red("a"), red("b")]));
  });
});
