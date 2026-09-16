export type WorldDigestKind = "COMPLETED" | "DEFECT" | "OPENED";
export type WorldDigest = {
  cursor: number;
  baseline: boolean;
  periodDays: number;
  truncated: boolean;
  totals: Record<WorldDigestKind, number>;
  items: { taskId: string; taskNumber: number; title: string; cityName: string; kind: WorldDigestKind; count: number; lastEventId: number }[];
};
