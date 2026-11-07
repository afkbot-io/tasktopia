import type { CityMobilityAgent } from './city-mobility';
import type { TransitRun } from './city-everyday-controller';
import type { TransitLine } from './city-transit-lines';
import type { InspectionTask, TransportInspection } from './city-world-inspection';

export function cityBusInspection(cityName: string, vehicle: CityMobilityAgent, current: Readonly<TransitRun> | undefined,
  lines: readonly TransitLine[], agents: readonly CityMobilityAgent[], visible: boolean, schoolTask?: InspectionTask): TransportInspection | undefined {
  if (!vehicle.fleet) return;
  const run = current?.vehicleId === vehicle.id ? current : undefined, line = lines.find(line => line.id === run?.lineId);
  return { kind: 'TRANSPORT', transportKind: 'BUS', title: vehicle.fleet === 'BUS' ? 'Автобус' : 'Школьный автобус',
    vehicleId: vehicle.id, journeyId: run?.id ?? `idle:${vehicle.id}`, routeId: run?.lineId ?? `bus:${vehicle.id}`,
    phase: run?.phase ?? 'WAITING', activity: run?.phase === 'BOARD' ? 'BOARDING' : run?.phase === 'ALIGHT' ? 'ALIGHTING' : run ? 'TRAVELLING' : 'WAITING',
    fromName: line ? `Остановка ${(run!.lineIndex ?? 0) + 1}` : cityName,
    toName: line ? `Остановка ${((run!.lineIndex ?? 0) + 1) % line.stops.length + 1}` : run?.school ? schoolTask?.title ?? 'Учебное здание' : undefined,
    progress: run?.phase === 'ALIGHT' ? 1 : 0, local: visible, position: visible ? vehicle.position : undefined,
    waiting: run ? agents.filter(a => a.visit?.id === run.id && !a.carrier).length : 0,
    aboard: agents.filter(a => a.carrier === vehicle.id).length, boarded: run?.boarded ?? 0, alighted: run?.alighted ?? 0,
    task: run?.school ? schoolTask : undefined };
}
