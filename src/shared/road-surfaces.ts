import type { Cell, RoadCellDto, SurfaceCellDto } from "./contracts";

const cellKey = (cell: Cell) => `${cell.x},${cell.y}`;

export const ROAD_WIDTH: Record<RoadCellDto["roadClass"], number> = {
  // Compact block streets use a three-cell, two-direction profile.
  // Country transit can still expose wider collectors and highways.
  LOCAL: 3,
  COLLECTOR: 7,
  ARTERIAL: 7,
  HIGHWAY: 7,
};


/** Canonical paved road envelope shared by resident chunks and clipped city exits. */
export function buildRoadSurfaces(input: {
  roads: ReadonlyMap<string, RoadCellDto>; blocked: ReadonlySet<string>;
  isSurfaceTerrain: (cell: Cell) => boolean; isInsideCity: (cell: Cell) => boolean;
}): Map<string, SurfaceCellDto> {
  const surfaces = new Map<string, SurfaceCellDto>();
  for (const road of input.roads.values()) {
    for (let y = -1; y <= 1; y += 1) for (let x = -1; x <= 1; x += 1) {
      if (x === 0 && y === 0) continue;
      const cell = { x: road.x + x, y: road.y + y };
      const key = cellKey(cell);
      if (input.roads.has(key) || input.blocked.has(key) || !input.isSurfaceTerrain(cell)) continue;
      const kind: SurfaceCellDto["kind"] = road.roadClass === "HIGHWAY" && !input.isInsideCity(cell) ? "SHOULDER" : "SIDEWALK";
      const existing = surfaces.get(key);
      if (!existing || existing.kind === "SHOULDER" && kind === "SIDEWALK") surfaces.set(key, { ...cell, kind });
    }
  }
  publishCrosswalks(input.roads, surfaces);
  return surfaces;
}

type CrosswalkCandidate = {
  cells: Cell[];
  orientation: "H" | "V";
  axis: number;
  group: string;
};

function publishCrosswalks(roads: ReadonlyMap<string, RoadCellDto>, surfaces: Map<string, SurfaceCellDto>): void {
  const candidates = new Map<string, CrosswalkCandidate>();
  for (const sidewalk of [...surfaces.values()].filter((surface) => surface.kind === "SIDEWALK")) {
    for (const direction of [{ x: 1, y: 0 }, { x: 0, y: 1 }] as const) {
      const first = { x: sidewalk.x + direction.x, y: sidewalk.y + direction.y };
      const firstRoad = roads.get(cellKey(first));
      if (!firstRoad || firstRoad.structure !== "ROAD" || firstRoad.roadClass === "HIGHWAY") continue;
      const expectedWidth = ROAD_WIDTH[firstRoad.roadClass];
      const cells: Cell[] = [];
      let current = first;
      while (roads.has(cellKey(current)) && cells.length < expectedWidth) {
        cells.push(current);
        current = { x: current.x + direction.x, y: current.y + direction.y };
      }
      if (surfaces.get(cellKey(current))?.kind !== "SIDEWALK" || cells.length !== expectedWidth) continue;
      if (cells.some((cell) => {
        const road = roads.get(cellKey(cell));
        return !road || road.structure !== "ROAD" || road.roadClass !== firstRoad.roadClass;
      })) continue;
      const orientation: "H" | "V" = direction.x !== 0 ? "H" : "V";
      const perpendicularCenter = orientation === "H"
        ? cells.reduce((sum, cell) => sum + cell.x, 0) / cells.length
        : cells.reduce((sum, cell) => sum + cell.y, 0) / cells.length;
      const axis = orientation === "H" ? sidewalk.y : sidewalk.x;
      const group = `${orientation}:${Math.round(perpendicularCenter * 2)}`;
      const candidateKey = cells.map(cellKey).sort().join("|");
      candidates.set(candidateKey, { cells, orientation, axis, group });
    }
  }

  const groups = new Map<string, CrosswalkCandidate[]>();
  for (const candidate of candidates.values()) groups.set(candidate.group, [...(groups.get(candidate.group) ?? []), candidate]);
  for (const group of groups.values()) {
    const ordered = group.sort((left, right) => left.axis - right.axis);
    const segments: CrosswalkCandidate[][] = [];
    for (const candidate of ordered) {
      const segment = segments.at(-1);
      if (!segment || candidate.axis - segment.at(-1)!.axis > 1) segments.push([candidate]);
      else segment.push(candidate);
    }
    for (const segment of segments) {
      // Short blocks get one central crossing. Long blocks receive a crossing
      // roughly every twelve cells, keeping the walk graph useful without
      // painting zebra stripes across the entire street.
      const firstIndex = Math.min(segment.length - 1, Math.max(0, Math.floor(Math.min(6, segment.length / 2))));
      for (let index = firstIndex; index < segment.length; index += 12) {
        const crossing = segment[index]!;
        for (const cell of crossing.cells) surfaces.set(cellKey(cell), { ...cell, kind: "CROSSWALK", orientation: crossing.orientation });
      }
    }
  }
}
