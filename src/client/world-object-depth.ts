export type WorldObjectKind = "DECORATION" | "AGENT" | "BUILDING" | "INCIDENT" | "FEATURE";
export type WorldObjectDepth = { groundY: number; kind: WorldObjectKind; id?: string };

const KIND_ORDER: Record<WorldObjectKind, number> = {
  DECORATION: 0,
  FEATURE: 1,
  AGENT: 2,
  BUILDING: 3,
  INCIDENT: 4,
};

/** Painter-order comparison based on the object's contact point with ground. */
export function compareWorldObjects(left: WorldObjectDepth, right: WorldObjectDepth): number {
  return left.groundY - right.groundY
    || KIND_ORDER[left.kind] - KIND_ORDER[right.kind]
    || (left.id ?? "").localeCompare(right.id ?? "");
}
