import type { ChunkTaskDto } from "../shared/contracts";

export type IncidentMode = "NONE" | "DEFECT_REPORTED" | "DEFECT_REPAIRING" | "DEFECT_VERIFYING" | "HOTFIX_QUEUED" | "HOTFIX_ACTIVE" | "HOTFIX_VERIFYING";
type IncidentTask = Pick<ChunkTaskDto, "workItemType" | "status" | "defectSummary">;
export type IncidentVisualProfile = {
  activeDefects: number;
  /** Unresolved issues only: verification is not an active fire. */
  smokeStrength: number;
  plumeCount: number;
  burning: boolean;
};
export type IncidentEffectAnchor = { x: number; y: number; phaseMs: number };
export type IncidentSurfaceBounds = { left: number; top: number; right: number; bottom: number };
export type IncidentVisualLayout = { flameAnchors: IncidentEffectAnchor[]; smokeAnchors: IncidentEffectAnchor[] };
export type IncidentWaterPixel = { x: number; y: number; size: number };
export type IncidentWaterJetFrame = { core: IncidentWaterPixel[]; highlights: IncidentWaterPixel[]; spray: IncidentWaterPixel[] };
export type IncidentWaterTargetFrame = { index: number; target: { x: number; y: number } };

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

/** Native 5×5 effect envelopes, bottom-centred to the same registered building
 * canvas. No fractional sprite scale or legacy tall-facade constants. */
export function incidentVisualLayout(
  spriteWidth: number, spriteHeight: number, profile: IncidentVisualProfile,
  opaqueBounds: IncidentSurfaceBounds = { left: 0, top: 0, right: spriteWidth, bottom: spriteHeight },
): IncidentVisualLayout {
  const left = Math.ceil(clamp(opaqueBounds.left, 0, spriteWidth)) + 2;
  const right = Math.floor(clamp(opaqueBounds.right, 0, spriteWidth)) - 3;
  const top = Math.ceil(clamp(opaqueBounds.top, 0, spriteHeight)) + 5;
  const bottom = Math.floor(clamp(opaqueBounds.bottom, 0, spriteHeight)) - 5;
  if (left > right || top > bottom) return { flameAnchors: [], smokeAnchors: [] };
  const count = right - left >= 24 ? 2 : 1;
  const anchors = (total: number, smoke: boolean): IncidentEffectAnchor[] => Array.from({ length: total }, (_, index) => ({
    x: Math.round(left + (right - left) * (total === 1 ? 0.5 : index === 0 ? 0.25 : 0.75) - spriteWidth / 2),
    y: Math.round(top + (bottom - top) * (smoke ? 0.15 : 0.6) - spriteHeight),
    phaseMs: index * 137,
  }));
  return {
    flameAnchors: anchors(profile.burning ? count : 0, false),
    smokeAnchors: anchors(Math.min(count, profile.plumeCount), true),
  };
}

/** A one-native-pixel hose fits a six-pixel vehicle; never a three-pixel pipe.
 * Integer DDA keeps adjacent pixels connected. Effects are confined to one lot. */
export function incidentWaterJetFrame(
  source: { x: number; y: number }, target: { x: number; y: number }, timeMs: number, phaseMs = 0,
): IncidentWaterJetFrame {
  const start = { x: Math.round(source.x), y: Math.round(source.y) };
  const end = { x: Math.round(target.x), y: Math.round(target.y) };
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(end.x - start.x), Math.abs(end.y - start.y))));
  if (steps > 96) return { core: [], highlights: [], spray: [] };
  const core = Array.from({ length: steps + 1 }, (_, index) => ({
    x: Math.round(start.x + (end.x - start.x) * index / steps),
    y: Math.round(start.y + (end.y - start.y) * index / steps),
    size: 1,
  }));
  const frame = Math.floor((Math.max(0, timeMs) + phaseMs) / 120);
  return {
    core,
    highlights: core.filter((_, index) => index % 5 === frame % 5),
    spray: [[-2, -1], [1, -2], [2, 1]].map(([x, y], index) => ({
      x: end.x + (frame % 2 && index === 0 ? -1 : x!),
      y: end.y + y!, size: 1,
    })),
  };
}

const WATER_TARGET_HOLD_MS = 1_600;
const WATER_TARGET_TURN_MS = 320;

/**
 * Select the facade point currently being extinguished. A crew holds each
 * point long enough for the stream to read at native scale, then moves the
 * nozzle across the facade over a short pixel-aligned transition instead of
 * teleporting one diagonal line to another.
 */
export function incidentWaterTargetFrame(
  targets: ReadonlyArray<{ x: number; y: number }>,
  timeMs: number,
  phaseMs = 0,
): IncidentWaterTargetFrame | undefined {
  if (targets.length === 0) return undefined;
  if (targets.length === 1) return { index: 0, target: targets[0]! };

  const elapsed = Math.max(0, timeMs + phaseMs);
  const cycle = Math.floor(elapsed / WATER_TARGET_HOLD_MS);
  const index = cycle % targets.length;
  const current = targets[index]!;
  const localMs = elapsed % WATER_TARGET_HOLD_MS;
  if (localMs >= WATER_TARGET_TURN_MS) return { index, target: current };

  const previous = targets[(index - 1 + targets.length) % targets.length]!;
  const linear = localMs / WATER_TARGET_TURN_MS;
  const eased = linear * linear * (3 - 2 * linear);
  return {
    index,
    target: {
      x: Math.round(previous.x + (current.x - previous.x) * eased),
      y: Math.round(previous.y + (current.y - previous.y) * eased),
    },
  };
}


export function incidentMode(task: IncidentTask): IncidentMode {
  const working = task.status === "STARTED" || task.status === "IN_PROGRESS";
  if (task.workItemType === "HOTFIX" && working) return "HOTFIX_ACTIVE";
  const defects = task.defectSummary;
  if (defects?.inProgress || (task.workItemType === "BUG" && working)) return "DEFECT_REPAIRING";
  if (defects?.open || (task.workItemType === "BUG" && task.status === "PLANNING")) return "DEFECT_REPORTED";
  if (task.workItemType === "HOTFIX" && task.status === "TESTING") return "HOTFIX_VERIFYING";
  if (defects?.verifying || (task.workItemType === "BUG" && task.status === "TESTING")) return "DEFECT_VERIFYING";
  if (task.workItemType === "HOTFIX" && task.status === "PLANNING") return "HOTFIX_QUEUED";
  return "NONE";
}

export function incidentVisualProfile(
  task: IncidentTask & Pick<ChunkTaskDto, "stage" | "visualKind">,
): IncidentVisualProfile {
  const defects = task.defectSummary;
  const activeDefects = defects ? Math.max(0, defects.active, defects.open + defects.inProgress + defects.verifying) : 0;
  const unresolved = Math.max(0, defects?.open ?? 0) + Math.max(0, defects?.inProgress ?? 0);
  const ownBug = task.workItemType === "BUG" && task.status !== "TESTING" && task.status !== "COMPLETED";
  const hotfixActive = task.workItemType === "HOTFIX" && (task.status === "STARTED" || task.status === "IN_PROGRESS");
  const structureExists = task.visualKind === "BUILDING" && task.stage >= 3;
  const smokeStrength = structureExists ? hotfixActive ? 6 : Math.min(6, unresolved + Number(ownBug)) : 0;
  return { activeDefects, smokeStrength, plumeCount: smokeStrength >= 3 ? 2 : smokeStrength > 0 ? 1 : 0, burning: smokeStrength >= 6 };
}

export function incidentRenderSignature(task: ChunkTaskDto, fullResponse: boolean): string {
  return JSON.stringify([incidentMode(task), fullResponse, task.workItemType, task.status, task.stage, task.origin,
    task.footprint, task.buildingType, task.visualKind, task.visualAssetKey, task.defectSummary]);
}

export const MAX_INCIDENT_ENGINES = 3;
const ENGINE_PRIORITY: Record<Exclude<IncidentMode, "NONE">, number> = {
  HOTFIX_ACTIVE: 0, DEFECT_REPAIRING: 1, DEFECT_REPORTED: 2,
  HOTFIX_QUEUED: 3, HOTFIX_VERIFYING: 4, DEFECT_VERIFYING: 5,
};

export function planIncidentEngines(incidents: ReadonlyArray<{
  id: string; mode: Exclude<IncidentMode, "NONE">; burning: boolean; smokeStrength?: number;
}>): Set<string> {
  const ranked = incidents.filter((incident) => incident.burning).sort((left, right) =>
    ENGINE_PRIORITY[left.mode] - ENGINE_PRIORITY[right.mode]
    || (right.smokeStrength ?? 0) - (left.smokeStrength ?? 0)
    || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  return new Set(ranked.slice(0, MAX_INCIDENT_ENGINES).map((incident) => incident.id));
}
