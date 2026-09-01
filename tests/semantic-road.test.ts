import { describe, expect, it } from "vitest";
import {
  auditSemanticRoadNetwork,
  decodeOrthogonalRoadRuns,
  encodeOrthogonalRoadPath,
  type SemanticRoadNetwork,
} from "../src/shared/semantic-road";

describe("semantic block-v1 roads", () => {
  it("round-trips an orthogonal path without storing every road cell", () => {
    const path = [
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 },
      { x: 2, y: 1 }, { x: 2, y: 2 }, { x: 1, y: 2 },
    ];
    const encoded = encodeOrthogonalRoadPath(path);
    expect(encoded).toEqual({
      start: { x: 0, y: 0 },
      runs: [
        { direction: "E", length: 2 },
        { direction: "S", length: 2 },
        { direction: "W", length: 1 },
      ],
    });
    expect(decodeOrthogonalRoadRuns(encoded)).toEqual(path);
  });

  it("rejects diagonal, repeated, and disconnected segment geometry", () => {
    expect(() => encodeOrthogonalRoadPath([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toThrow(/orthogonal/i);
    expect(() => encodeOrthogonalRoadPath([{ x: 0, y: 0 }, { x: 0, y: 0 }])).toThrow(/adjacent/i);

    const network: SemanticRoadNetwork = {
      schemaVersion: 1,
      nodes: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 3, y: 0 }],
      segments: [{
        id: "ab",
        fromNodeId: "a",
        toNodeId: "b",
        roadClass: "LOCAL",
        widthCells: 3,
        geometry: { start: { x: 0, y: 0 }, runs: [{ direction: "E", length: 2 }] },
      }],
    };
    expect(() => auditSemanticRoadNetwork(network)).toThrow(/endpoint/i);
  });

  it("accepts a connected network whose segments terminate on declared nodes", () => {
    const network: SemanticRoadNetwork = {
      schemaVersion: 1,
      nodes: [
        { id: "west", x: 0, y: 4 },
        { id: "junction", x: 4, y: 4 },
        { id: "south", x: 4, y: 8 },
      ],
      segments: [
        {
          id: "west-junction",
          fromNodeId: "west",
          toNodeId: "junction",
          roadClass: "COLLECTOR",
          widthCells: 7,
          geometry: { start: { x: 0, y: 4 }, runs: [{ direction: "E", length: 4 }] },
        },
        {
          id: "junction-south",
          fromNodeId: "junction",
          toNodeId: "south",
          roadClass: "LOCAL",
          widthCells: 3,
          geometry: { start: { x: 4, y: 4 }, runs: [{ direction: "S", length: 4 }] },
        },
      ],
    };
    expect(auditSemanticRoadNetwork(network)).toEqual(network);
  });
});
