import { createHash } from "node:crypto";
import type { CityBlockV1 } from "../../shared/block-world";
import type { SemanticRoadNode } from "../../shared/semantic-road";
import { transaction, type Db } from "../db";
import { permanentSiteBounds } from "./permanent-task-sites";
import { planIntercityRoads, type IntercityRoadPlan } from "./intercity-road-planner";

export type CountryRoadSnapshot = { revision: number; topologyHash: string; plan: IntercityRoadPlan };
type StoredRow = { revision: number; topology_hash: string; plan_json: IntercityRoadPlan };
const fromRow = (row: StoredRow): CountryRoadSnapshot => ({ revision: Number(row.revision), topologyHash: row.topology_hash, plan: row.plan_json });
export function countryRoadTopologyHash(seed: number, heads: readonly { city_id: string; checksum: string }[]): string {
  return createHash("sha256").update(JSON.stringify({ seed, heads: [...heads].sort((a, b) => a.city_id.localeCompare(b.city_id)) })).digest("hex");
}

/** One indexed country lookup, no A*, migrations, or repair on a GET. */
export async function readCountryRoads(db: Db, countryId: string): Promise<CountryRoadSnapshot | undefined> {
  const row = await db.prepare("SELECT revision,topology_hash,plan_json FROM country_road_snapshots_v1 WHERE country_id=?")
    .get<StoredRow>(countryId);
  return row && fromRow(row);
}

/** Runs under the same country lock/transaction as the topology mutation.
 * Task statuses, names and comments never invalidate the topology digest.
 * The injected pure planner is a test seam, not a production fallback. */
export async function synchronizeCountryRoads(db: Db, countryId: string, planner = planIntercityRoads): Promise<CountryRoadSnapshot> {
  return transaction(db, async () => {
    const country = await db.prepare("SELECT seed FROM countries WHERE id=? FOR UPDATE").get<{ seed: number }>(countryId);
    if (!country) throw new Error("Unknown intercity road country");
    const heads = await db.prepare(`SELECT l.city_id,r.checksum FROM city_layouts_v1 l
      JOIN road_networks_v1 r ON r.layout_id=l.id WHERE l.country_id=? AND l.status='ACTIVE' ORDER BY l.city_id`)
      .all<{ city_id: string; checksum: string }>(countryId);
    const topologyHash = countryRoadTopologyHash(Number(country.seed), heads);
    const previous = await readCountryRoads(db, countryId);
    if (previous?.topologyHash === topologyHash && previous.plan.plannerVersion === 2) return previous;
    const rows = await db.prepare(`SELECT l.city_id,r.nodes_json,
      (SELECT COALESCE(jsonb_agg(jsonb_build_object('origin',jsonb_build_object('x',b.origin_x,'y',b.origin_y),
        'width',b.width,'height',b.height) ORDER BY b.id),'[]') FROM city_blocks_v1 b WHERE b.layout_id=l.id) AS blocks
      FROM city_layouts_v1 l JOIN road_networks_v1 r ON r.layout_id=l.id
      WHERE l.country_id=? AND l.status='ACTIVE' ORDER BY l.city_id`)
      .all<{ city_id: string; nodes_json: SemanticRoadNode[]; blocks: Pick<CityBlockV1, "origin" | "width" | "height">[] }>(countryId);
    // An empty city's temporary eight-cell starter street is not an enduring
    // exit. Wait for its first actual block so that the first task can still fit.
    const developed = rows.filter(row => row.blocks.length > 0);
    const ids = new Set(developed.map(row => row.city_id));
    // City deletion explicitly removes its incident routes, not surviving ones.
    const retained = previous?.plan.routes.filter(route => ids.has(route.fromCityId) && ids.has(route.toCityId));
    const plan = planner({ countryId, seed: Number(country.seed), allowBridges:true,
      cities: developed.map(row => ({ id: row.city_id, nodes: row.nodes_json, blocks: row.blocks })),
      protectedSites: await permanentSiteBounds(db, countryId, true),
      ...(previous ? { previous: { countryId, seed: previous.plan.seed, routes: retained! } } : {}),
    });
    const revision = (previous?.revision ?? 0) + 1;
    await db.prepare(`INSERT INTO country_road_snapshots_v1(country_id,revision,topology_hash,plan_json)
      VALUES(?,?,?,?::jsonb) ON CONFLICT(country_id) DO UPDATE SET revision=excluded.revision,
      topology_hash=excluded.topology_hash,plan_json=excluded.plan_json,updated_at=now()`)
      .run(countryId, revision, topologyHash, JSON.stringify(plan));
    return { revision, topologyHash, plan };
  });
}
