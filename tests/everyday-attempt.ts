type Snapshot = Readonly<Record<string, string | undefined>>;
type Sample = Readonly<{ kind: string; phase: string; serverNow: number; arrivals: number; animals: number }>;
type Observation = Readonly<{
  arrivals: number; animals: number; fetched: boolean; scattered: boolean;
  activityArrivals: boolean; eligibleActivity: boolean; assetsUnavailable: boolean;
  invalidTelemetry: boolean; truncated: boolean; samples: readonly Sample[];
  ended?: Readonly<{ episodeId: string; serverNow: number; nextEpisodeId: string }>;
}>;

function metric(value: string | undefined): number | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const result = Number(value);
  return Number.isFinite(result) && Math.abs(result) <= Number.MAX_SAFE_INTEGER ? result : undefined;
}

function count(value: string | undefined): number | undefined {
  const result = metric(value);
  return result !== undefined && Number.isSafeInteger(result) && result >= 0 ? result : undefined;
}

const safety = ['mobilityVehicleUnsafeTotal', 'mobilityPedestrianUnsafeTotal',
  'mobilityVehiclePedestrianUnsafeTotal', 'wrongWayCars', 'walkerOffPath'] as const;
const phases = ['ARRIVE', 'ACTIVITY', 'LEAVE'] as const;
function phaseAt(offset: number): string | undefined {
  if (!Number.isFinite(offset) || offset < 0 || offset >= 44_000) return undefined;
  return offset < 10_000 ? 'ARRIVE' : offset < 34_000 ? 'ACTIVITY' : 'LEAVE';
}
function activeAndSafe(snapshot: Snapshot): boolean {
  return snapshot.mapActive === 'true' && snapshot.animationActive === 'true' && snapshot.ambientAssets === 'ready'
    && safety.every(key => count(snapshot[key]) === 0);
}

/** A naturally expired slot is not a positive scene. The caller must still
 * qualify all six kinds within its original bounded calendar search. */
export function isEverydayAttemptExpiredWithoutArrival(input: {
  scheduledStartMs: number; kind: string; taskId: string;
  initial: Snapshot; terminal: Snapshot; observed: Observation; errors: readonly string[];
}): boolean {
  const { scheduledStartMs: start, kind, taskId, initial, terminal, observed, errors } = input;
  if (!Number.isSafeInteger(start) || start < 0 || start > Number.MAX_SAFE_INTEGER - 44_000
    || !['SCHOOL', 'KINDERGARTEN', 'MARKET', 'SPORT', 'DOG', 'BIRDS'].includes(kind) || !taskId.trim()
    || !Array.isArray(errors) || errors.length || !activeAndSafe(initial) || !activeAndSafe(terminal)) return false;
  const initialNow = metric(initial.roadEventServerNow), terminalNow = metric(terminal.roadEventServerNow);
  const initialPhase = initialNow === undefined ? undefined : phaseAt(initialNow - start);
  const initialSteps = count(initial.mobilityFixedSteps), terminalSteps = count(terminal.mobilityFixedSteps);
  const visitors = count(initial.everydayVisitors);
  const empty = terminal.everydayEvent === '' && terminal.everydayPhase === '' && terminal.everydayTask === ''
    && terminal.everydayEpisodeId === '' && terminal.everydaySkip === 'expired'
    && count(terminal.everydayVisitors) === 0 && count(terminal.everydayArrived) === 0;
  const end = observed.ended;
  const successor = !!terminal.everydayEpisodeId && terminal.everydayEpisodeId !== initial.everydayEpisodeId
    && ['SCHOOL','KINDERGARTEN','MARKET','SPORT','DOG','BIRDS'].includes(terminal.everydayEvent ?? '')
    && terminal.everydayPhase === 'ARRIVE' && !!terminal.everydayTask?.trim()
    && count(terminal.everydayVisitors) !== undefined && count(terminal.everydayArrived) !== undefined
    && end?.episodeId === initial.everydayEpisodeId && Number.isFinite(end?.serverNow)
    && end!.serverNow >= start + 44_000 && end!.serverNow <= (terminalNow ?? -Infinity)
    && (end!.nextEpisodeId === '' || end!.nextEpisodeId === terminal.everydayEpisodeId);
  if (initialNow === undefined || terminalNow === undefined || terminalNow < start + 44_000
    || initial.everydayEvent !== kind || initial.everydayTask !== taskId || !initial.everydayEpisodeId?.trim()
    || initialPhase === undefined || initial.everydayPhase !== initialPhase || count(initial.everydayArrived) !== 0
    || visitors === undefined || visitors === 0 || initialSteps === undefined || terminalSteps === undefined || terminalSteps - initialSteps < 500
    || !empty && !successor
    || observed.arrivals !== 0 || observed.animals !== 0 || observed.fetched !== false || observed.scattered !== false
    || observed.activityArrivals !== false || observed.eligibleActivity !== false || observed.assetsUnavailable !== false
    || observed.invalidTelemetry !== false || observed.truncated !== false || !Array.isArray(observed.samples) || !observed.samples.length) return false;
  let lastPhase = -1, lastNow = -Infinity;
  for (const sample of observed.samples) {
    const phase = phases.indexOf(sample.phase as typeof phases[number]);
    if (sample.kind !== kind || sample.arrivals !== 0 || sample.animals !== 0
      || !Number.isFinite(sample.serverNow) || Math.abs(sample.serverNow) > Number.MAX_SAFE_INTEGER
      || phase < 0 || sample.phase !== phaseAt(sample.serverNow - start) || phase < lastPhase || phase > lastPhase + 1
      || sample.serverNow < lastNow || sample.serverNow > terminalNow) return false;
    lastPhase = phase; lastNow = sample.serverNow;
  }
  return lastPhase === phases.length - 1 && (!successor || lastNow <= end!.serverNow);
}
