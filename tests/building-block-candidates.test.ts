import { describe, expect, it } from "vitest";
import { buildingBlockCandidates } from "../src/shared/block-templates";
import { packBuildingParcels } from "../src/shared/block-parcel-plan";

describe("building-aware block candidates", () => {
  it("skips the preferred narrow block for an east-west gallery without rotating it", () => {
    expect(buildingBlockCandidates(5, { width: 12, height: 6 }).map(t => t.key)).toEqual([
      "residential-court", "residential-row", "residential-pair", "residential-square", "residential-strip",
    ]);
  });

  it("keeps a north-south gallery vertical and skips shallow blocks", () => {
    expect(buildingBlockCandidates(4, { width: 6, height: 12 }).map(t => t.key)).toEqual([
      "residential-court", "residential-row", "residential-pair", "residential-square", "residential-tower",
    ]);
  });

  it("reserves construction clearance and access even at the maximum fitting size", () => {
    expect(buildingBlockCandidates(6, { width: 25, height: 25 }).map(t => t.key)).toEqual(["residential-court"]);
    expect(buildingBlockCandidates(0, { width: 26, height: 25 })).toEqual([]);
  });

  it("preserves the existing preferred-template order for ordinary houses", () => {
    for (let sequence = 0; sequence < 14; sequence++) {
      const candidates = buildingBlockCandidates(sequence);
      expect(candidates).toHaveLength(7);
      expect(candidates[0]!.key).toBe([
        "residential-court", "residential-row", "residential-pair", "residential-square",
        "residential-strip", "residential-tower", "residential-single",
      ][sequence % 7]);
      expect(buildingBlockCandidates(sequence, { width: 6, height: 6 })).toEqual(candidates);
    }
  });

  it("every returned candidate really packs the requested shape in every corner", () => {
    for (const [width, height] of [[12, 6], [6, 12], [18, 6], [12, 9], [25, 25]]) {
      const shape = { family: "test-only-shape", width: width!, height: height! };
      for (const candidate of buildingBlockCandidates(6, shape)) for (const corner of ["NW", "NE", "SW", "SE"] as const) {
        const parcels = packBuildingParcels({ width: candidate.widthModules * 8, height: candidate.heightModules * 8,
          shapes: [shape], firstFamily: shape.family, corner, seed: 1742 });
        expect(parcels[0]).toMatchObject({ family: shape.family, width, height, clearance: 1, kind: "BUILDING" });
      }
    }
  });

  it("rejects invalid planning dimensions and sequence instead of silently rotating or clipping", () => {
    for (const width of [0, -1, 1.5, NaN, Infinity]) expect(buildingBlockCandidates(0, { width, height: 6 })).toEqual([]);
    for (const sequence of [-1, 0.5, NaN, Infinity]) expect(() => buildingBlockCandidates(sequence)).toThrow(/sequence/);
  });
});
