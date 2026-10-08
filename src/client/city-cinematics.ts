import type { ChunkTaskDto, WorldFeatureDto } from '../shared/contracts';
export type CityCinematicKind = "CONSTRUCT" | "DEMOLISH" | "TRANSFER";
/** Only the current parcel participates; historical move sites remain visible. */
export function cinematicMarkerMatches(kind: CityCinematicKind, task: Pick<ChunkTaskDto,'taskNumber'|'footprint'>, feature: Pick<WorldFeatureDto,'siteMarker'|'footprint'>) {
  if (kind !== 'DEMOLISH' || feature.siteMarker?.snapshot.taskNumber !== task.taskNumber || feature.siteMarker.kind !== 'RUINED' || !task.footprint.length || !feature.footprint.length) return false;
  const bounds = (cells: ChunkTaskDto['footprint']) => [Math.min(...cells.map(c=>c.x)),Math.min(...cells.map(c=>c.y)),Math.max(...cells.map(c=>c.x)),Math.max(...cells.map(c=>c.y))];
  const source=bounds(task.footprint),marker=bounds(feature.footprint);
  return source.every((value,index)=>value===marker[index]);
}
export type CityCinematicRequest = { eventId: number; version: number; taskId: string; kind: CityCinematicKind; fromStage: number; toStage?: number; occurredAtMs?: number };
export type CityCinematicPhase = "CREW" | "WORK" | "COVER" | "REVEAL" | "APPROACH" | "LIFT" | "CARRY" | "LOWER" | "DEPART";
export type CityCinematicFrame = CityCinematicRequest & { startedAtMs: number; elapsedMs: number; progress: number; phaseProgress: number; phase: CityCinematicPhase; oldVisible: boolean; revealTarget: boolean; done: boolean };
type Entry = { request: CityCinematicRequest; start: number; readyVersion: number };
const schedules: Record<CityCinematicKind, ReadonlyArray<readonly [number, CityCinematicPhase]>> = {
  CONSTRUCT: [[650, "CREW"], [2200, "WORK"], [2750, "COVER"], [3100, "REVEAL"]],
  DEMOLISH: [[800, "CREW"], [1600, "WORK"], [2500, "COVER"], [2900, "REVEAL"]],
  TRANSFER: [[900, "APPROACH"], [1700, "LIFT"], [4200, "CARRY"], [5000, "LOWER"], [5700, "DEPART"]],
};

/** Presentation only: authoritative task state is never held back by this clock. */
export function createCityCinematics(capacity = 3) {
  const active = new Map<string, Entry>();
  const versions = new Map<string, number>();
  const limit = Math.max(1, Math.min(3, Math.floor(capacity) || 1));
  return {
    begin(request: CityCinematicRequest, now: number) {
      if (!request.taskId || !Number.isFinite(now) || !Number.isSafeInteger(request.version)
        || request.version <= Math.max(versions.get(request.taskId) ?? -1, active.get(request.taskId)?.request.version ?? -1)) return false;
      versions.delete(request.taskId);
      versions.set(request.taskId, request.version);
      while (versions.size > 512) versions.delete(versions.keys().next().value!);
      if (request.occurredAtMs !== undefined && (!Number.isFinite(request.occurredAtMs) || now - request.occurredAtMs > 10_000)) return false;
      if (request.kind === "CONSTRUCT" && request.fromStage === request.toStage) return false;
      const current = active.get(request.taskId);
      if (current) {
        if (current.request.kind === "DEMOLISH") return false;
        const kind = current.request.kind === "TRANSFER" && request.kind === "CONSTRUCT" ? "TRANSFER" : request.kind;
        if (kind !== current.request.kind) current.start = now;
        current.request = { ...request, kind, fromStage: current.request.fromStage };
        return true;
      }
      if (active.size >= limit) return false;
      active.set(request.taskId, { request: { ...request }, start: now, readyVersion: -1 });
      return true;
    },
    ready(taskId: string, version: number) {
      const entry = active.get(taskId);
      if (entry) entry.readyVersion = Math.max(entry.readyVersion, version);
    },
    sample(now: number): CityCinematicFrame[] {
      const frames: CityCinematicFrame[] = [];
      if (!Number.isFinite(now)) return frames;
      for (const [id, entry] of active) {
        const elapsedMs = Math.max(0, now - entry.start);
        const schedule = schedules[entry.request.kind], duration = schedule.at(-1)![0];
        const ready = entry.readyVersion >= entry.request.version;
        let index = schedule.findIndex(([end]) => elapsedMs < end);
        if (index < 0) index = schedule.length - 1;
        if (!ready && elapsedMs >= schedule.at(-2)![0]) index = schedule.length - 2;
        if (!ready && entry.request.kind === "TRANSFER" && elapsedMs >= 1700) index = 1;
        const [end, phase] = schedule[index]!;
        const start = index === 0 ? 0 : schedule[index - 1]![0];
        const revealTarget = ready && elapsedMs >= schedule.at(-2)![0];
        const done = elapsedMs >= duration + 2000 || revealTarget && elapsedMs >= duration;
        frames.push({ ...entry.request, startedAtMs: entry.start, elapsedMs, progress: Math.min(1, elapsedMs / duration),
          phaseProgress: Math.min(1, Math.max(0, (elapsedMs - start) / (end - start))), phase,
          oldVisible: !revealTarget && !done, revealTarget, done });
        if (done) active.delete(id);
      }
      return frames;
    },
    cancel(taskId: string) { active.delete(taskId); },
    clear(): string[] { const ids = [...active.keys()]; active.clear(); return ids; },
    get size() { return active.size; },
    get historySize() { return versions.size; },
  };
}
