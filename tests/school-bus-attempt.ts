// Ceremony, pending handoff after its end, physical bus leg, then the
// actual child's walking visit. These are separate existing app bounds.
export const SCHOOL_BUS_OBSERVATION_WORLD_MS = 44_000 + 80_000 + 80_000 + 60_000;

type Snapshot = Readonly<{
  roadEventServerNow?: string;
  transitRole?: string;
  schoolBusVisits?: string;
  schoolBusArrived?: string;
  schoolBuses?: string;
  schoolBusPendingTask?: string;
}>;

function metric(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const result = Number(value);
  return Number.isFinite(result) ? result : undefined;
}

function count(value: string | undefined): number | undefined {
  const result = metric(value);
  return result !== undefined && Number.isSafeInteger(result) && result >= 0 ? result : undefined;
}

/** Preserve a queued delivery after its ceremony, a live bus and children
 * still walking from its stop to the school. Missing queue state is unknown. */
export function isSchoolBusAttemptTerminal(input: {
  scheduledStartMs: number;
  before: Snapshot;
  current: Snapshot;
  observedSchoolBus: boolean;
}): boolean {
  const { scheduledStartMs, before, current } = input;
  const now = metric(current.roadEventServerNow);
  const arrivedBefore = count(before.schoolBusArrived), arrivedNow = count(current.schoolBusArrived);
  const busesBefore = count(before.schoolBuses), busesNow = count(current.schoolBuses);
  const witnessed = input.observedSchoolBus || before.transitRole === 'SCHOOL_BUS'
    || busesBefore !== undefined && busesNow !== undefined && busesNow > busesBefore;
  return Number.isSafeInteger(scheduledStartMs) && Math.abs(scheduledStartMs) <= Number.MAX_SAFE_INTEGER - 44_000
    && now !== undefined && Math.abs(now) <= Number.MAX_SAFE_INTEGER && now >= scheduledStartMs + 44_000
    && busesBefore !== undefined && busesNow !== undefined && busesNow >= busesBefore
    && witnessed && (current.transitRole === '' || current.transitRole === 'BUS')
    && current.schoolBusPendingTask === ''
    && count(current.schoolBusVisits) === 0 && arrivedBefore !== undefined && arrivedNow === arrivedBefore;
}
