import type { Locator } from '@playwright/test';

type CineObservation = { performanceNowMs: number; dateNowMs: number; publicHost: Record<string, string | null> };
export type CineSample = { firstObserved: CineObservation; lastObserved: CineObservation; states: { taskId: string; kind: string; phase: string; fromStage: number; toStage?: number; oldVisible: boolean; targetVisible: boolean; aircraftVisible: boolean }[];
  workers: number; ghosts: number; cpuP95: number; cpuMax: number };
type CineNode = HTMLElement & { __qaCinematics?: { records: CineSample[]; observer: MutationObserver } };

// Observe a whole published frame, before the command. Separate protocol reads
// can span WORK/COVER on a software GPU; polling can miss a short phase entirely.
export async function observeCinematics(host: Locator) {
  await host.evaluate(el => {
    const node = el as CineNode; node.__qaCinematics?.observer.disconnect();
    const records: CineSample[] = []; let signature = '';
    // Private diagnostic enrichment only: timestamps describe observation callbacks,
    // not GPU presentation. Missing public host values remain explicitly null.
    const observation = (): CineObservation => ({ performanceNowMs: performance.now(), dateNowMs: Date.now(), publicHost: {
      loading: node.dataset.loading ?? null,
      canonicalSnapshotPending: node.dataset.canonicalSnapshotPending ?? null,
      citySceneRevision: node.dataset.citySceneRevision ?? null,
      movementPreparing: node.dataset.movementPreparing ?? null,
      cameraPresentationPending: node.dataset.cameraPresentationPending ?? null,
      animationActive: node.dataset.animationActive ?? null,
      cinematicLastDecision: node.dataset.cinematicLastDecision ?? null,
      mapActive: node.dataset.mapActive ?? null,
      citySceneCommit: node.dataset.citySceneCommit ?? null,
      worldQuality: node.dataset.worldQuality ?? null,
      cityFirstFrameRendered: node.dataset.cityFirstFrameRendered ?? null,
    } });
    const read = () => {
      const d = node.dataset, states: CineSample['states'] = JSON.parse(d.cinematicState ?? '[]');
      const workers = Number(d.cinematicWorkers ?? 0), ghosts = Number(d.cityCinematics ?? 0);
      const next = JSON.stringify(states.map(s => [s.taskId, s.kind, s.phase, s.fromStage, s.toStage, s.oldVisible, s.targetVisible, s.aircraftVisible])) + `:${workers}:${ghosts}`;
      if (signature === next) {
        const last=records.at(-1);
        if(last){last.cpuP95=Math.max(last.cpuP95,Number(d.livingWorldFrameCpuP95Ms??0));last.cpuMax=Math.max(last.cpuMax,Number(d.livingWorldFrameCpuMaxMs??0));last.lastObserved=observation();}
        return;
      }
      signature = next;
      const observed = observation();
      records.push({ firstObserved: observed, lastObserved: observed, states, workers, ghosts, cpuP95: Number(d.livingWorldFrameCpuP95Ms ?? 0), cpuMax: Number(d.livingWorldFrameCpuMaxMs ?? 0) });
      if (records.length > 32) records.shift();
    };
    const observer = new MutationObserver(read);
    observer.observe(node, { attributes: true, attributeFilter: ['data-cinematic-state', 'data-cinematic-workers', 'data-city-cinematics'] });
    node.__qaCinematics = { records, observer };
  });
  const frames = () => host.evaluate(el => (el as CineNode).__qaCinematics!.records);
  return { frames, clear: () => host.evaluate(el => { const recorder = (el as CineNode).__qaCinematics!; recorder.observer.takeRecords(); recorder.records.length = 0; }) };
}

