import { expect, it } from "vitest";
import { transportJourneys, transportSchedule, transportStopActivity, TRANSPORT_EPOCH } from "../src/shared/transport-schedule";

it("serves a railway station every 72 seconds with stable individual vehicles", () => {
  const schedule = transportSchedule("RAIL", "a", "b"), base = TRANSPORT_EPOCH - schedule.offsetMs;
  const at = (time: number) => transportJourneys(schedule, "a", base + time);
  expect(at(0)).toHaveLength(3);
  expect(new Set(at(0).map(j => j.vehicleId)).size).toBe(3);
  for (const time of [0, 72_000, 144_000, 216_000]) expect(at(time).filter(j => j.phase === "STOPPED" && j.progress === 0)).toHaveLength(1);
  const replay = at(5_000);
  expect(transportJourneys({ ...schedule }, "a", base + 5_000)).toEqual(replay);
  expect(transportJourneys(transportSchedule("RAIL", "b", "a"), "a", base + 5_000)).toEqual(replay);
});

it("has distinct unloading, boarding and closed door intervals at both stops", () => {
  const schedule = transportSchedule("RAIL", "a", "b"), base = TRANSPORT_EPOCH - schedule.offsetMs;
  const first = (time: number, source = "a") => transportJourneys(schedule, source, base + time)[0]!;
  expect(transportStopActivity(schedule, first(500))).toBe("OPENING");
  expect(transportStopActivity(schedule, first(3_000))).toBe("ALIGHTING");
  expect(transportStopActivity(schedule, first(10_000))).toBe("BOARDING");
  expect(transportStopActivity(schedule, first(17_500))).toBe("CLOSING");
  expect(transportStopActivity(schedule, first(20_000))).toBe("TRAVELLING");
  expect(transportStopActivity(schedule, first(schedule.dwellMs + schedule.travelMs + 3_000, "b"))).toBe("ALIGHTING");
  expect(transportStopActivity(schedule, first(schedule.dwellMs + schedule.travelMs + 3_000, "a"))).toBe("TRAVELLING");
});

it("preserves a stop visit identity across door phases, but separates the next visit", () => {
  const schedule = transportSchedule("RAIL", "a", "b"), base = TRANSPORT_EPOCH - schedule.offsetMs;
  const at = (time: number) => transportJourneys(schedule, "a", base + time)[0]!;
  expect(at(500).visitId).toBe(at(10_000).visitId);
  expect(at(500).visitId).not.toBe(at(216_500).visitId);
  expect(at(500).vehicleId).toBe(at(216_500).vehicleId);
  expect(at(500).journeyId).not.toBe(at(216_500).journeyId);
});

import { nextTransportDeparture, transportJourney } from "../src/shared/transport-schedule";
it("derives the nearest absolute departure across all vehicles at either endpoint",()=>{
  const schedule=transportSchedule("RAIL","a","b",0),base=TRANSPORT_EPOCH;
  expect(nextTransportDeparture(schedule,"a",base+20_000)).toBe(base+90_000);
  expect(nextTransportDeparture(schedule,"b",base+20_000)).toBe(base+54_000);
  expect(nextTransportDeparture(schedule,"a",base+90_000)).toBe(base+90_000);
  expect(Number.isFinite(nextTransportDeparture(schedule,"a",NaN))).toBe(true);
  expect(()=>transportJourney(schedule,"missing",base)).toThrow();
});
