import { describe, expect, it } from 'vitest';
import { isEverydayAttemptExpiredWithoutArrival } from './everyday-attempt';

const start = 100_000;
const safety = { mobilityVehicleUnsafeTotal: '0', mobilityPedestrianUnsafeTotal: '0',
  mobilityVehiclePedestrianUnsafeTotal: '0', wrongWayCars: '0', walkerOffPath: '0' };
const initial = { ...safety, mapActive: 'true', animationActive: 'true', ambientAssets: 'ready',
  roadEventServerNow: String(start + 1850), mobilityFixedSteps: '100', everydayEvent: 'BIRDS', everydayPhase: 'ARRIVE',
  everydayTask: 'park', everydayEpisodeId: 'city:window:park:birds', everydayVisitors: '1', everydayArrived: '0' };
const terminal = { ...initial, roadEventServerNow: String(start + 44_000), mobilityFixedSteps: '700',
  everydayEvent: '', everydayPhase: '', everydayTask: '', everydayEpisodeId: '', everydayVisitors: '0', everydaySkip: 'expired' };
const sample = (phase: string, offset: number) => ({ kind: 'BIRDS', phase, serverNow: start + offset, arrivals: 0, animals: 0 });
const observed = { arrivals: 0, animals: 0, fetched: false, scattered: false, activityArrivals: false, eligibleActivity: false,
  assetsUnavailable: false, invalidTelemetry: false, truncated: false,
  samples: [sample('ARRIVE', 650), sample('ACTIVITY', 10_025), sample('LEAVE', 34_014)] };
const input = { scheduledStartMs: start, kind: 'BIRDS', taskId: 'park', initial, terminal, observed, errors: [] as string[] };
type Input = Parameters<typeof isEverydayAttemptExpiredWithoutArrival>[0];
const expired = (changes: Partial<Input> = {}) => isEverydayAttemptExpiredWithoutArrival({ ...input, ...changes });

describe('непройденная everyday попытка с доказанным естественным истечением', () => {
  it('использует точное свидетельство истечения, когда отказ следующей попытки заменил последний skip', () => {
    const ended={episodeId:initial.everydayEpisodeId,serverNow:start+44_000,nextEpisodeId:''};
    for(const everydaySkip of ['busy','offscreen']){
      const current={...terminal,everydaySkip};
      expect(expired({terminal:current,observed:{...observed,ended}})).toBe(true);
      expect(expired({terminal:current})).toBe(false);
      expect(expired({terminal:current,observed:{...observed,ended:{...ended,serverNow:start+43_999}}})).toBe(false);
      expect(expired({terminal:current,observed:{...observed,ended:{...ended,episodeId:'another'}}})).toBe(false);
      expect(expired({terminal:current,observed:{...observed,ended:{...ended,nextEpisodeId:'other'}}})).toBe(false);
    }
  });
  it('принимает целиком наблюдавшийся слот с реальным назначением и физическими шагами', () => {
    expect(expired()).toBe(true);
    expect(expired({ observed: { ...observed, samples: [sample('ARRIVE', 650), sample('ARRIVE', 9000),
      sample('ACTIVITY', 10_000), sample('ACTIVITY', 33_999), sample('LEAVE', 34_000), sample('LEAVE', 43_999)] } })).toBe(true);
  });

  it('различает истёкший слот и уже начавшееся следующее событие по наблюдаемому episode ID', () => {
    const successor={...terminal,everydayEvent:'SCHOOL',everydayPhase:'ARRIVE',everydayTask:'school',
      everydayEpisodeId:'city:window:school',everydayVisitors:'2',everydaySkip:''};
    const ended={episodeId:initial.everydayEpisodeId,serverNow:start+44_000,nextEpisodeId:successor.everydayEpisodeId};
    const history={...observed,ended};
    expect(expired({terminal:successor,observed:history})).toBe(true);
    expect(expired({terminal:successor})).toBe(false);
    expect(expired({terminal:successor,observed:{...history,ended:{...ended,serverNow:start+43_999}}})).toBe(false);
    expect(expired({terminal:successor,observed:{...history,ended:{...ended,episodeId:'another-episode'}}})).toBe(false);
    expect(expired({terminal:successor,observed:{...history,ended:{...ended,nextEpisodeId:initial.everydayEpisodeId}}})).toBe(false);
    expect(expired({terminal:successor,observed:{...history,ended:{...ended,nextEpisodeId:''}}})).toBe(true);
    for(const serverNow of [NaN,Infinity,start+44_001])expect(expired({terminal:successor,observed:{...history,ended:{...ended,serverNow}}})).toBe(false);
    expect(expired({terminal:{...successor,everydayEvent:'UNKNOWN'},observed:history})).toBe(false);
    expect(expired({terminal:{...successor,everydayPhase:'LEAVE'},observed:history})).toBe(false);
    expect(expired({terminal:{...successor,everydayTask:''},observed:history})).toBe(false);
    expect(expired({terminal:successor,observed:{...history,arrivals:1}})).toBe(false);
    expect(expired({terminal:{...successor,everydayEpisodeId:initial.everydayEpisodeId},observed:history})).toBe(false);
    expect(expired({terminal:{...successor,mobilityFixedSteps:'101'},observed:history})).toBe(false);
  });

  it('сохраняет границу44s и не создаёт истечение из прежнего40s окна', () => {
    expect(expired({ terminal: { ...terminal, roadEventServerNow: String(start + 43_999.99) } })).toBe(false);
    expect(expired({ terminal: { ...terminal, roadEventServerNow: String(start + 44_000) } })).toBe(true);
  });

  it('историческая запись без initial witness не доказывает назначение или физику', () => {
    expect(expired({ initial: {} })).toBe(false);
    const missingSteps: Record<string, string> = { ...initial }; delete missingSteps.mobilityFixedSteps;
    expect(expired({ initial: missingSteps })).toBe(false);
    expect(expired({ initial: { ...initial, everydayVisitors: '0' } })).toBe(false);
    expect(expired({ terminal: { ...terminal, mobilityFixedSteps: initial.mobilityFixedSteps } })).toBe(false);
    expect(expired({ terminal: { ...terminal, mobilityFixedSteps: '99' } })).toBe(false);
  });

  it('не пропускает любое положительное прибытие или необъяснимое появление животных', () => {
    expect(expired({ observed: { ...observed, arrivals: 1 } })).toBe(false);
    expect(expired({ observed: { ...observed, activityArrivals: true } })).toBe(false);
    expect(expired({ observed: { ...observed, eligibleActivity: true } })).toBe(false);
    expect(expired({ observed: { ...observed, samples: [observed.samples[0]!, { ...observed.samples[1]!, arrivals: 1 }, observed.samples[2]!] } })).toBe(false);
    expect(expired({ observed: { ...observed, animals: 1 } })).toBe(false);
    expect(expired({ initial: { ...initial, everydayArrived: '1' } })).toBe(false);
    expect(expired({ terminal: { ...terminal, everydayArrived: '1' } })).toBe(false);
  });

  it.each([
    { samples: [] }, { samples: [sample('ACTIVITY', 10_000), sample('LEAVE', 34_000)] },
    { samples: [sample('ARRIVE', 650), sample('LEAVE', 34_000)] },
    { samples: [sample('ARRIVE', 650), sample('ACTIVITY', 10_000)] },
    { samples: [sample('ARRIVE', 650), sample('ACTIVITY', 10_000), sample('ARRIVE', 9000), sample('LEAVE', 34_000)] },
  ])('требует все три фазы в реальном порядке: %j', ({ samples }) => {
    expect(expired({ observed: { ...observed, samples } })).toBe(false);
  });

  it.each([
    sample('ARRIVE', -1), sample('ARRIVE', 10_000), sample('ACTIVITY', 9999), sample('ACTIVITY', 34_000),
    sample('LEAVE', 33_999), sample('LEAVE', 44_000), sample('LEAVE', NaN), sample('LEAVE', Infinity),
  ])('отклоняет время, не принадлежащее заявленной фазе: %j', invalid => {
    const samples = observed.samples.map(entry => entry.phase === invalid.phase ? invalid : entry);
    expect(expired({ observed: { ...observed, samples } })).toBe(false);
  });

  it('отклоняет обратный ход часов внутри одной фазы', () => {
    expect(expired({ observed: { ...observed, samples: [sample('ARRIVE', 650), sample('ARRIVE', 600), ...observed.samples.slice(1)] } })).toBe(false);
  });

  it('требует тот же известный вид и наблюдаемый task/episode', () => {
    expect(expired({ kind: 'UNKNOWN' })).toBe(false);
    expect(expired({ initial: { ...initial, everydayEvent: 'DOG' } })).toBe(false);
    expect(expired({ initial: { ...initial, everydayTask: 'another-park' } })).toBe(false);
    expect(expired({ initial: { ...initial, everydayEpisodeId: '' } })).toBe(false);
    expect(expired({ observed: { ...observed, samples: observed.samples.map(entry => ({ ...entry, kind: 'DOG' })) } })).toBe(false);
  });

  it.each(['busy', 'invalidated', 'offscreen', 'late', ''])('не принимает причину завершения %j', everydaySkip => {
    expect(expired({ terminal: { ...terminal, everydaySkip } })).toBe(false);
  });

  it('не принимает всё ещё живую или скрытую сцену и ошибки страницы', () => {
    expect(expired({ terminal: { ...terminal, everydayEvent: 'BIRDS' } })).toBe(false);
    expect(expired({ terminal: { ...terminal, everydayPhase: 'LEAVE' } })).toBe(false);
    expect(expired({ terminal: { ...terminal, everydayVisitors: '1' } })).toBe(false);
    for (const field of ['mapActive', 'animationActive']) {
      expect(expired({ initial: { ...initial, [field]: 'false' } })).toBe(false);
      expect(expired({ terminal: { ...terminal, [field]: 'false' } })).toBe(false);
    }
    expect(expired({ errors: ['renderer failed'] })).toBe(false);
  });

  it.each(['assetsUnavailable', 'invalidTelemetry', 'truncated'] as const)('требует полноценную телеметрию: %s', flag => {
    expect(expired({ observed: { ...observed, [flag]: true } })).toBe(false);
  });

  it('не допускает потери assets или нарушения любого safety counter', () => {
    expect(expired({ terminal: { ...terminal, ambientAssets: 'loading' } })).toBe(false);
    for (const field of Object.keys(safety)) {
      expect(expired({ initial: { ...initial, [field]: '1' } })).toBe(false);
      expect(expired({ terminal: { ...terminal, [field]: '1' } })).toBe(false);
    }
  });

  it.each(['', 'NaN', 'Infinity', '-1', '0.5'])('отклоняет некорректный счётчик %j', value => {
    for (const field of ['mobilityFixedSteps', 'everydayVisitors']) expect(expired({ initial: { ...initial, [field]: value } })).toBe(false);
    for (const field of ['mobilityFixedSteps', 'everydayArrived', 'walkerOffPath']) expect(expired({ terminal: { ...terminal, [field]: value } })).toBe(false);
  });

  it('отклоняет неизвестные и нечисловые время/флаги без неявного false', () => {
    for (const scheduledStartMs of [NaN, Infinity, -1, Number.MAX_SAFE_INTEGER]) expect(expired({ scheduledStartMs })).toBe(false);
    for (const roadEventServerNow of ['', 'NaN', 'Infinity']) {
      expect(expired({ initial: { ...initial, roadEventServerNow } })).toBe(false);
      expect(expired({ terminal: { ...terminal, roadEventServerNow } })).toBe(false);
    }
    expect(expired({ initial: { ...initial, everydayPhase: 'UNKNOWN' } })).toBe(false);
    for (const offset of [-1, 44_000, 45_000]) {
      expect(expired({ initial: { ...initial, roadEventServerNow: String(start + offset), everydayPhase: undefined } })).toBe(false);
    }
    expect(expired({ terminal: { ...terminal, mapActive: undefined } })).toBe(false);
    expect(expired({ observed: { ...observed, truncated: undefined } as unknown as Input['observed'] })).toBe(false);
    expect(expired({ observed: { ...observed, samples: undefined } as unknown as Input['observed'] })).toBe(false);
    expect(expired({ observed: { ...observed, samples: [sample('ARRIVE', 650), sample('UNKNOWN', 10_025), sample('LEAVE', 34_014)] } })).toBe(false);
  });
});
