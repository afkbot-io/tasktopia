import type { ChunkTaskDto } from "../shared/contracts";

export type IncidentMode = "NONE" | "DEFECT_REPORTED" | "DEFECT_REPAIRING" | "DEFECT_VERIFYING" | "HOTFIX_ACTIVE";
export type IncidentVisualProfile = {
  activeDefects: number;
  /** 0 = quiet, 1..5 = progressively denser smoke, 6 = saturated smoke/fire. */
  smokeStrength: number;
  plumeCount: number;
  burning: boolean;
};

export type IncidentVisualLayout = {
  flameAnchors: IncidentEffectAnchor[];
  smokeAnchors: IncidentEffectAnchor[];
};

export type IncidentEffectAnchor = { x: number; y: number; scale: number; phaseMs: number };
export type IncidentSurfaceBounds = { left: number; top: number; right: number; bottom: number };
export type IncidentWaterPixel = { x: number; y: number; size: number };
export type IncidentWaterJetFrame = {
  core: IncidentWaterPixel[];
  highlights: IncidentWaterPixel[];
  spray: IncidentWaterPixel[];
};

const FIRE_X_FRACTIONS = [0, 1, 0.2, 0.8, 0.4, 0.6] as const;
const FIRE_Y_FRACTIONS = [0.72, 0.34, 0.5, 0.82, 0.22, 0.61] as const;
const FIRE_SCALE_FACTORS = [0.82, 1.12, 0.94, 1.18, 0.88, 1.04] as const;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function effectAnchors(
  count: number,
  spriteWidth: number,
  spriteHeight: number,
  surface: IncidentSurfaceBounds,
): IncidentEffectAnchor[] {
  if (count <= 0) return [];
  const width = Math.max(1, surface.right - surface.left);
  const height = Math.max(1, surface.bottom - surface.top);
  const insetX = Math.min(4, Math.floor(width / 2));
  const insetTop = Math.min(8, Math.floor(height * 0.18));
  const insetBottom = Math.min(10, Math.floor(height * 0.22));
  const left = surface.left + insetX - spriteWidth / 2;
  const right = surface.right - insetX - spriteWidth / 2;
  const top = surface.top + insetTop - spriteHeight;
  const bottom = surface.bottom - insetBottom - spriteHeight;
  const baseScale = clamp(0.68 + Math.sqrt(width * height) / 560, 0.7, 1.05);
  const anchors = Array.from({ length: count }, (_, index) => ({
    x: Math.round(left + (right - left) * (count === 1 ? 0.5 : FIRE_X_FRACTIONS[index]!)),
    y: Math.round(top + (bottom - top) * FIRE_Y_FRACTIONS[index]!),
    scale: Math.round(clamp(baseScale * FIRE_SCALE_FACTORS[index]!, 0.64, 1.24) * 100) / 100,
    phaseMs: index * 137,
  }));
  return anchors.sort((first, second) => first.x - second.x);
}

/**
 * Place incident effects across the actual facade instead of stacking every
 * plume on one arbitrary pixel. Anchors remain inside the sprite silhouette,
 * scale with its width and are deterministic for chunk reconciliation.
 */
export function incidentVisualLayout(
  spriteWidth: number,
  spriteHeight: number,
  profile: IncidentVisualProfile,
  opaqueBounds: IncidentSurfaceBounds = { left: 0, top: 0, right: spriteWidth, bottom: spriteHeight },
): IncidentVisualLayout {
  const surface = {
    left: clamp(opaqueBounds.left, 0, spriteWidth),
    top: clamp(opaqueBounds.top, 0, spriteHeight),
    right: clamp(opaqueBounds.right, 0, spriteWidth),
    bottom: clamp(opaqueBounds.bottom, 0, spriteHeight),
  };
  const surfaceWidth = Math.max(1, surface.right - surface.left);
  const surfaceHeight = Math.max(1, surface.bottom - surface.top);
  const flameCount = profile.burning
    ? clamp(Math.ceil(surfaceWidth / 40) + (surfaceHeight >= 96 ? Math.ceil(surfaceHeight / 120) : 0), 1, 6)
    : 0;
  const flames = effectAnchors(flameCount, spriteWidth, spriteHeight, surface);
  const smokeBase = profile.plumeCount <= 0
    ? []
    : flames.length > 0
    ? flames.filter((_, index) => index % Math.max(1, Math.floor(flames.length / profile.plumeCount)) === 0).slice(0, profile.plumeCount)
    : effectAnchors(profile.plumeCount, spriteWidth, spriteHeight, surface);
  return {
    flameAnchors: flames,
    smokeAnchors: smokeBase.map((anchor, index) => ({
      ...anchor,
      y: Math.max(surface.top - spriteHeight, anchor.y - 6),
      scale: Math.min(1.24, Math.round((anchor.scale + 0.08 + index * 0.04) * 100) / 100),
      phaseMs: anchor.phaseMs + 73,
    })),
  };
}

/**
 * Build a crisp, continuously connected hose stream plus moving highlights
 * and impact spray. Only the small highlight/spray layers move; both hose and
 * facade contact points remain stable between animation frames.
 */
export function incidentWaterJetFrame(
  source: { x: number; y: number },
  target: { x: number; y: number },
  timeMs: number,
  phaseMs = 0,
): IncidentWaterJetFrame {
  const distance = Math.hypot(target.x - source.x, target.y - source.y);
  const steps = Math.max(2, Math.ceil(distance / 1.7));
  const arcHeight = Math.min(14, distance * 0.08);
  const pointAt = (index: number): IncidentWaterPixel => {
    const ratio = index / steps;
    return {
      x: Math.round(source.x + (target.x - source.x) * ratio),
      y: Math.round(source.y + (target.y - source.y) * ratio - Math.sin(Math.PI * ratio) * arcHeight),
      size: 2,
    };
  };
  const core = Array.from({ length: steps + 1 }, (_, index) => pointAt(index));
  const animationStep = Math.floor((timeMs + phaseMs * 17) / 70);
  const highlights: IncidentWaterPixel[] = [];
  for (let index = ((animationStep % 7) + 7) % 7; index <= steps; index += 7) {
    const point = pointAt(index);
    highlights.push({ ...point, size: 1 });
  }
  const sprayPattern = [
    [-4, -2], [-2, -5], [1, -4], [4, -1], [-3, 2], [2, 2],
  ] as const;
  const sprayFrame = ((Math.floor((timeMs + phaseMs * 11) / 90) % 4) + 4) % 4;
  const spray = sprayPattern.map(([x, y], index) => ({
    x: target.x + x + (index % 2 === 0 ? sprayFrame - 1 : 1 - sprayFrame),
    y: target.y + y + (index % 3 === 0 ? sprayFrame - 1 : 0),
    size: index < 2 ? 2 : 1,
  }));
  return { core, highlights, spray };
}

export function incidentMode(task: Pick<ChunkTaskDto, "workItemType" | "status" | "defectSummary">): IncidentMode {
  if (task.workItemType === "HOTFIX" && task.status !== "PLANNING" && task.status !== "COMPLETED") return "HOTFIX_ACTIVE";
  const defects = task.defectSummary;
  if (defects?.inProgress) return "DEFECT_REPAIRING";
  if (defects?.verifying) return "DEFECT_VERIFYING";
  if (defects?.open) return "DEFECT_REPORTED";
  return "NONE";
}

export function incidentVisualProfile(
  task: Pick<ChunkTaskDto, "workItemType" | "status" | "defectSummary">,
): IncidentVisualProfile {
  const defects = task.defectSummary;
  const activeDefects = defects
    ? Math.max(0, defects.active, defects.open + defects.inProgress + defects.verifying)
    : 0;
  const activeHotfix = task.workItemType === "HOTFIX" && task.status !== "PLANNING" && task.status !== "COMPLETED";
  if (activeDefects === 0 && !activeHotfix) {
    return { activeDefects: 0, smokeStrength: 0, plumeCount: 0, burning: false };
  }

  const smokeStrength = activeHotfix ? 6 : Math.min(activeDefects, 6);
  return {
    activeDefects,
    smokeStrength,
    plumeCount: smokeStrength >= 5 ? 3 : smokeStrength >= 3 ? 2 : 1,
    burning: activeHotfix || activeDefects > 5,
  };
}

/**
 * A whole fire crew per open defect turns a buggy release into a fire
 * station parade (the screenshot incident: eight engines in one row). At
 * most three full engine overlays are visible at once; the rest degrade to
 * a compact pulsing roof alarm. Active emergencies always outrank mere
 * reports.
 */
export const MAX_INCIDENT_ENGINES = 3;

const ENGINE_PRIORITY: Record<Exclude<IncidentMode, "NONE">, number> = {
  HOTFIX_ACTIVE: 0,
  DEFECT_REPAIRING: 1,
  DEFECT_VERIFYING: 2,
  DEFECT_REPORTED: 3,
};

export function planIncidentEngines(incidents: ReadonlyArray<{
  id: string;
  mode: Exclude<IncidentMode, "NONE">;
  burning?: boolean;
  smokeStrength?: number;
}>): Set<string> {
  const ranked = [...incidents].sort((left, right) =>
    Number(Boolean(right.burning)) - Number(Boolean(left.burning))
    || ENGINE_PRIORITY[left.mode] - ENGINE_PRIORITY[right.mode]
    || (right.smokeStrength ?? 0) - (left.smokeStrength ?? 0)
    || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  return new Set(ranked.slice(0, MAX_INCIDENT_ENGINES).map((incident) => incident.id));
}
