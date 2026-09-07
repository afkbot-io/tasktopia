import type { CityBlockV1 } from "../../shared/block-world";
import { blockSlots } from "../../shared/block-templates";
import type { Cell, Rect, WorldFeatureDto } from "../../shared/contracts";
import type { Db } from "../db";

type Row = Record<string, unknown>;
const parse = <T>(value: unknown): T => (typeof value === "string" ? JSON.parse(value) : value) as T;
type SiteGeometry = { origin: Cell; footprint: Cell[]; siteBounds: Rect };

function geometry(row: Row): SiteGeometry {
  if (row.geometry_json) return parse<SiteGeometry>(row.geometry_json);
  // Pre-migration records carry the immutable versioned block snapshot, never
  // a newly generated/current block. First mutation freezes its exact cells.
  const b = parse<Row>(row.block_snapshot_json);
  const block: CityBlockV1 = { id: String(b.id), districtLayoutId: String(b.district_layout_id), sequence: Number(b.sequence),
    kind: b.kind as CityBlockV1["kind"], templateKey: String(b.template_key), templateVersion: Number(b.template_version),
    variant: String(b.variant), seed: Number(b.seed), origin: { x: Number(b.origin_x), y: Number(b.origin_y) },
    width: Number(b.width), height: Number(b.height), parameters: parse(b.parameters_json), summary: parse(b.summary_json) };
  const slot = blockSlots(block).find(slot => slot.key === row.slot_key);
  if (!slot) throw new Error(`Permanent site has an invalid historical slot: ${row.id}`);
  return { origin: slot.origin, footprint: slot.footprint, siteBounds: slot.siteBounds };
}

/** Mutation-only backfill: reads never mutate durable history. */
export async function freezePermanentSiteGeometry(db: Db, countryId: string): Promise<void> {
  const rows = await db.prepare("SELECT * FROM site_markers_v1 WHERE country_id=? AND geometry_json IS NULL").all<Row>(countryId);
  for (const row of rows) await db.prepare("UPDATE site_markers_v1 SET geometry_json=?::jsonb WHERE id=? AND geometry_json IS NULL")
    .run(JSON.stringify(geometry(row)), row.id);
}

export async function permanentSiteBounds(db: Db, countryId: string, orphanedOnly = false): Promise<Rect[]> {
  const rows = await db.prepare(`SELECT * FROM site_markers_v1 WHERE country_id=? ${orphanedOnly ? "AND layout_id IS NULL" : ""}`).all<Row>(countryId);
  return rows.map(row => geometry(row).siteBounds);
}

export async function readPermanentSiteFeatures(db: Db, countryId: string, bounds?: Rect): Promise<WorldFeatureDto[]> {
  const rows = await db.prepare(`SELECT * FROM site_markers_v1 WHERE country_id=? ${bounds ? `AND
    (block_snapshot_json->>'origin_x')::int<=? AND (block_snapshot_json->>'origin_x')::int+(block_snapshot_json->>'width')::int>=?
    AND (block_snapshot_json->>'origin_y')::int<=? AND (block_snapshot_json->>'origin_y')::int+(block_snapshot_json->>'height')::int>=?` : ""} ORDER BY id`)
    .all<Row>(countryId, ...(bounds ? [bounds.maxX,bounds.minX,bounds.maxY,bounds.minY] : []));
  return rows.flatMap(row => {
    const site = geometry(row);
    if (bounds && !site.footprint.some(c => c.x >= bounds.minX && c.x <= bounds.maxX && c.y >= bounds.minY && c.y <= bounds.maxY)) return [];
    const snapshot = parse<Row>(row.snapshot_json);
    const recordedAt = row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at);
    let hash = 0; for (const char of `${row.id}:${snapshot.buildingFamily}`) hash = (Math.imul(hash,31)+char.charCodeAt(0)) >>> 0;
    return [{ id: String(row.id), cityId: String(row.city_id), districtId: String(row.district_id), parentFeatureId: null,
      kind: "RUIN", assetKind: "AREA", assetKey: "demolished-lot", origin: site.origin, footprint: site.footprint,
      orientation: "S", accessPath: [], developmentStage: 1,
      siteMarker: { kind: row.kind as "RUINED" | "RELOCATED", permanent: true, targetTaskId: row.target_task_id ? String(row.target_task_id) : null,
        snapshot: { taskNumber: Number(snapshot.taskNumber), title: String(snapshot.title ?? "Historical site"),
          buildingFamily: String(snapshot.buildingFamily ?? ""), lastStage: Number(snapshot.lastStage ?? 1) as 1|2|3|4|5, recordedAt },
        variant: (["brick","frame","overgrown"] as const)[hash % 3]! } }];
  });
}
