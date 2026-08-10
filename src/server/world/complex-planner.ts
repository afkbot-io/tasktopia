import type {
  BlockPattern,
  Cell,
  DistrictArchetype,
  PlannedLotDto,
  PlannedLotPosition,
  Rect,
} from "../../shared/contracts";
import { cellKey, rectangleFootprint } from "./grid";
import { hashCoordinate } from "./terrain";

/**
 * V10 complex planner. A complex (ЖК) is one coherent perimeter block that
 * grows along its own streets: every tier is a two-row street corridor with a
 * row of south-facing lots flush to the sidewalk above it, so the next street
 * naturally runs behind the previous row — the way real residential districts
 * densify. Courtyard strips face a pedestrian path that is tied to the street
 * at two points, which makes dead-end paths impossible by construction.
 *
 * All catalog buildings face south (entrance side "S"), therefore every lot
 * faces south and tall blocks stack more tiers instead of rotating.
 */
export type ComplexPlan = {
  shape: BlockPattern;
  /** Street centerlines; each segment is one orthogonal polyline. */
  streets: Cell[][];
  /** Courtyard path skeleton; published as PATH only with committed lots. */
  courtyard: Cell[];
  lots: PlannedLotDto[];
};

export type ComplexPlanInput = {
  districtId: string;
  complexIndex: number;
  /** Block bounds (inclusive) inside the district territory. */
  rect: Rect;
  /** Allowed district cells — lots outside them are dropped. */
  cells: Cell[];
  archetype: DistrictArchetype;
  /** Demand hint: the complex is sized to host roughly this many buildings. */
  targetLots: number;
  /** The demand that caused growth must fit at least one generated lot. */
  minimumLot?: { width: number; height: number };
  seed: number;
  /** Force a shape (tests, special sites); otherwise chosen from the palette. */
  shape?: BlockPattern;
  /**
   * Reserve one service slot in this complex. The caller passes false when the
   * district already has a SUPPORT lot — one service slot per district is
   * enough, reserving one per complex strands housing land in residential-only
   * workloads.
   */
  reserveSupport?: boolean;
};

type ArchetypeProfile = { baseW: number; minW: number; maxW: number; depth: number };

const PROFILE: Record<DistrictArchetype, ArchetypeProfile> = {
  NEW_BUILD: { baseW: 6, minW: 5, maxW: 8, depth: 5 },
  PRIVATE: { baseW: 4, minW: 3, maxW: 5, depth: 4 },
  // Mixed-use catalog entries include 5-cell-deep podiums and towers. A
  // four-cell lot made those valid buildings impossible to place and forced
  // speculative district growth before falling back to an unrelated model.
  MIXED_URBAN: { baseW: 5, minW: 4, maxW: 7, depth: 5 },
  COMMERCIAL: { baseW: 7, minW: 6, maxW: 9, depth: 5 },
  CIVIC: { baseW: 6, minW: 5, maxW: 8, depth: 5 },
};

const POINT_PROFILE: ArchetypeProfile = { baseW: 5, minW: 4, maxW: 6, depth: 5 };

/**
 * Organic districts reserve only the next small construction cluster.
 * Capacity is planning metadata, not a request to pave the whole sprint on
 * the first task. A square-root cap keeps enough alternate lots for mixed
 * building sizes without recreating the sparse 16+ lot superblocks that
 * dominated small districts with empty roads.
 */
export function organicComplexLotTarget(capacitySp: number): number {
  return Math.max(3, Math.min(8, Math.ceil(Math.sqrt(Math.max(1, capacitySp)) * 1.4)));
}

function horizontalLine(fromX: number, toX: number, y: number): Cell[] {
  return Array.from({ length: Math.max(0, toX - fromX + 1) }, (_, index) => ({ x: fromX + index, y }));
}

function verticalLine(x: number, fromY: number, toY: number): Cell[] {
  return Array.from({ length: Math.max(0, toY - fromY + 1) }, (_, index) => ({ x, y: fromY + index }));
}

/** CityEngine-style split with seeded irregularity; the tail is spread over the last lots. */
function splitStrip(length: number, profile: ArchetypeProfile, seed: number, salt: number): number[] {
  const widths: number[] = [];
  let remaining = length;
  let index = 0;
  while (remaining >= profile.minW) {
    const h = hashCoordinate(seed, salt, index * 13 + 1, 977);
    let width = Math.round(profile.baseW + (h - 0.5) * (profile.maxW - profile.minW));
    width = Math.max(profile.minW, Math.min(profile.maxW, width));
    widths.push(Math.min(width, remaining));
    remaining -= widths.at(-1)!;
    index += 1;
  }
  // Spread a too-short tail (+1 cell per lot from the end) before widening the last lot.
  let cursor = widths.length - 1;
  while (remaining > 0 && cursor >= 0) {
    if (widths[cursor]! < profile.maxW) {
      widths[cursor]! += 1;
      remaining -= 1;
    }
    cursor -= 1;
  }
  if (remaining > 0 && widths.length > 0) widths[widths.length - 1]! += remaining;
  return widths;
}

function tiersThatFit(rect: Rect, depth: number): number {
  const pitch = depth + 4;
  let count = 0;
  while (rect.maxY - 2 - count * pitch >= rect.minY + depth + 2) count += 1;
  return count;
}

function chooseShape(input: ComplexPlanInput, fit: number): BlockPattern {
  if (input.targetLots <= 4) return input.archetype === "NEW_BUILD" ? "COMPLEX_POINT" : "COMPLEX_ROW";
  const h = hashCoordinate(input.seed, input.rect.minX, input.rect.minY, 431 + input.complexIndex);
  if (fit >= 3) return h < 0.5 ? "COMPLEX_SLAB" : "COMPLEX_SQUARE";
  if (fit === 2) return h < 0.35 ? "COMPLEX_SQUARE" : h < 0.6 ? "COMPLEX_L_SHAPE" : h < 0.8 ? "COMPLEX_SLAB" : "COMPLEX_COURT";
  return "COMPLEX_ROW";
}

export function planComplex(input: ComplexPlanInput): ComplexPlan {
  const baseProfile = input.shape === "COMPLEX_POINT" ? POINT_PROFILE : PROFILE[input.archetype];
  const requiredWidth = Math.max(baseProfile.minW, input.minimumLot?.width ?? 0);
  const profile: ArchetypeProfile = {
    ...baseProfile,
    baseW: Math.max(baseProfile.baseW, requiredWidth),
    minW: requiredWidth,
    maxW: Math.max(baseProfile.maxW, requiredWidth),
    depth: Math.max(baseProfile.depth, input.minimumLot?.height ?? 0),
  };
  const fit = tiersThatFit(input.rect, profile.depth);
  const shape = input.shape ?? chooseShape(input, fit);
  const groupId = `${input.districtId}:complex:${String(input.complexIndex).padStart(3, "0")}`;
  const facadeFamily = `${input.archetype.toLowerCase()}-${Math.floor(hashCoordinate(input.seed, input.rect.minX, input.rect.minY, 613 + input.complexIndex) * 5)}`;
  const allowed = new Set(input.cells.map(cellKey));

  const depth = profile.depth;
  const pitch = depth + 4;
  const wantsCourtyard = shape === "COMPLEX_SQUARE" || shape === "COMPLEX_COURT";
  const maxTiers = shape === "COMPLEX_ROW" || shape === "COMPLEX_POINT" ? 1 : wantsCourtyard ? 2 : fit;

  const sideStreet: "E" | "W" | null = shape === "COMPLEX_L_SHAPE"
    ? (hashCoordinate(input.seed, input.rect.minX, input.rect.maxY, 449 + input.complexIndex) < 0.5 ? "E" : "W")
    : null;

  // Lot strip x-range per shape: side streets and courtyard connectors reserve
  // their columns so paths never cross a building. A multi-tier complex
  // reserves one more column on its spine side: the perimeter spine street
  // sits inside the block there, and its two-cell corridor must not spill
  // outside the rect.
  const spineSide: "E" | "W" | null = !sideStreet && fit > 1 && shape !== "COMPLEX_ROW" && shape !== "COMPLEX_POINT"
    ? (hashCoordinate(input.seed, input.rect.minX, input.rect.maxY, 461 + input.complexIndex) < 0.5 ? "E" : "W")
    : null;
  const stripMinX = input.rect.minX + (wantsCourtyard || sideStreet === "W" || spineSide === "W" ? 3 : 2);
  const stripMaxX = input.rect.maxX - (wantsCourtyard || sideStreet === "E" || spineSide === "E" ? 3 : 2);

  // Demand-driven height: the complex stacks only as many tiers as the current
  // demand needs, so a district never over-plans pads that stay vacant.
  const lotsPerTier = Math.max(2, Math.floor((stripMaxX - stripMinX + 1) / profile.baseW));
  const demandTiers = Math.max(1, Math.ceil(input.targetLots / lotsPerTier));
  const tierCount = Math.max(1, Math.min(fit, maxTiers, demandTiers));

  const streets: Cell[][] = [];
  const lots: PlannedLotDto[] = [];
  const pushStrip = (corridorTop: number, position: PlannedLotPosition, salt: number, courtyard: Cell[]) => {
    let x = stripMinX;
    const widths = splitStrip(stripMaxX - stripMinX + 1, profile, input.seed, salt);
    const cornerIndex = sideStreet === "E" ? widths.length - 1 : sideStreet === "W" ? 0 : -1;
    widths.forEach((width, index) => {
      const lotPosition = position === "FRONTAGE" && index === cornerIndex ? "CORNER" : position;
      // Corner position is a layout marker only. The single service slot of a
      // complex is assigned once after the final lot count is known — marking
      // every tier's corner as SUPPORT reserved far more service land than a
      // district can ever fill.
      lots.push({
        id: `${groupId}:lot:00`,
        origin: { x, y: corridorTop - depth - 1 },
        width,
        height: depth,
        taskId: null,
        layoutVersion: "block-v3",
        groupId,
        pattern: shape,
        role: "PRIMARY",
        position: lotPosition,
        frontageSide: "S",
        facadeFamily,
        sharedAccess: courtyard,
      });
      x += width;
    });
  };

  if (shape === "COMPLEX_POINT") {
    const corridorTop = input.rect.maxY - 2;
    const target = Math.max(2, Math.min(4, input.targetLots));
    const range = stripMaxX - stripMinX + 1;
    const stripLength = Math.min(range, target * profile.baseW);
    const startX = stripMinX + Math.floor((range - stripLength) / 2);
    let x = startX;
    for (const width of splitStrip(stripLength, profile, input.seed, 701)) {
      lots.push({
        id: `${groupId}:lot:00`,
        origin: { x, y: corridorTop - depth - 1 },
        width,
        height: depth,
        taskId: null,
        layoutVersion: "block-v3",
        groupId,
        pattern: shape,
        role: "PRIMARY",
        position: "FRONTAGE",
        frontageSide: "S",
        facadeFamily,
        sharedAccess: [],
      });
      x += width;
    }
    streets.push(horizontalLine(input.rect.minX, input.rect.maxX, corridorTop + 1));
  } else {
    for (let tier = 0; tier < tierCount; tier += 1) {
      const corridorTop = input.rect.maxY - 2 - tier * pitch;
      streets.push(horizontalLine(input.rect.minX, input.rect.maxX, corridorTop + 1));
      pushStrip(corridorTop, "FRONTAGE", 503 + tier * 29, []);
    }
  }
  if (sideStreet === "E") streets.push(verticalLine(input.rect.maxX - 1, input.rect.minY, input.rect.maxY));
  if (sideStreet === "W") streets.push(verticalLine(input.rect.minX + 1, input.rect.minY, input.rect.maxY));

  // A multi-tier complex gets one perimeter spine street inside a strip end.
  // Parallel tier streets without a cross street never reach the road network:
  // the publisher keeps only corridor cells connected to existing roads, so a
  // spineless upper tier street would silently vanish and strand its lots.
  // One spine is enough for connectivity — a second would double the asphalt
  // share without adding access.
  if (tierCount > 1 && spineSide) {
    const topStreetY = input.rect.maxY - 2 - (tierCount - 1) * pitch + 1;
    const bottomStreetY = input.rect.maxY - 1;
    const spineX = spineSide === "W" ? input.rect.minX + 1 : input.rect.maxX - 1;
    streets.push(verticalLine(spineX, topStreetY, bottomStreetY));
  }

  // Courtyard strip (SQUARE/COURT): one more south-facing row behind the top
  // tier, served by a pedestrian path tied to the top street at both ends.
  const courtyard: Cell[] = [];
  if (wantsCourtyard) {
    const topCorridor = input.rect.maxY - 2 - (tierCount - 1) * pitch;
    const pathY = topCorridor - depth - 3;
    const courtyardDepth = Math.max(2, depth - 2);
    const rowTop = pathY - courtyardDepth;
    const gardenRows = rowTop - 1 - input.rect.minY;
    const fits = rowTop >= input.rect.minY + 1 && (shape !== "COMPLEX_COURT" || gardenRows >= 2);
    if (fits) {
      const leftX = input.rect.minX + 2;
      const rightX = input.rect.maxX - 2;
      courtyard.push(
        ...horizontalLine(leftX, rightX, pathY),
        ...verticalLine(leftX, pathY, topCorridor - 1),
        ...verticalLine(rightX, pathY, topCorridor - 1),
      );
      const courtyardProfile = { ...profile, maxW: profile.baseW + 1, minW: Math.max(3, profile.minW - 1), baseW: Math.max(3, profile.baseW - 1) };
      let x = stripMinX;
      const widths = splitStrip(stripMaxX - stripMinX + 1, courtyardProfile, input.seed, 887);
      for (const width of widths) {
        lots.push({
          id: `${groupId}:lot:00`,
          origin: { x, y: pathY - courtyardDepth },
          width,
          height: courtyardDepth,
          taskId: null,
          layoutVersion: "block-v3",
          groupId,
          pattern: shape,
          role: "PRIMARY",
          position: "COURTYARD",
          frontageSide: "S",
          facadeFamily,
          sharedAccess: courtyard,
        });
        x += width;
      }
    }
  }

  // Drop lots that fall outside the allowed territory, then number the slots.
  const valid = lots.filter((lot) => rectangleFootprint(lot.origin, lot.width, lot.height).every((cell) => allowed.has(cellKey(cell))));
  const final = valid.map((lot, index) => ({
    ...lot,
    id: `${groupId}:lot:${String(index).padStart(2, "0")}`,
    slotIndex: index,
    slotCount: valid.length,
  }));
  // Real residential complexes put their service ground floor / corner store
  // at the end of the main street row. Guarantee one support slot per district
  // for zoning-strict archetypes so a clinic or fire station always has a
  // legal place without leaving the complex. Later complexes share that slot:
  // reserving one per complex strands housing land in residential-only
  // workloads. A small infill complex never reserves its own either.
  if (input.archetype !== "MIXED_URBAN" && (input.reserveSupport ?? true) && final.length >= 8 && !final.some((lot) => lot.role === "SUPPORT")) {
    const frontage = final.filter((lot) => lot.position === "FRONTAGE");
    if (frontage.length > 0) {
      const bottomY = Math.max(...frontage.map((lot) => lot.origin.y));
      // The service slot takes the widest bay of the main row so bulky civic
      // buildings (fire station, clinic) always fit.
      const bottom = frontage.filter((lot) => lot.origin.y === bottomY).sort((a, b) => b.width - a.width);
      bottom[0]!.role = "SUPPORT";
    }
  }
  return { shape, streets, courtyard, lots: final };
}
