import type { CompiledBlockLayoutV1 } from "../../shared/block-world";
import { auditSemanticRoadNetwork } from "../../shared/semantic-road";
import { transaction, type Db } from "../db";

type StoredLayout = { status: string; checksum: string | null };

export async function persistReadyBlockLayout(db: Db, layout: CompiledBlockLayoutV1, timestamp: string): Promise<void> {
  auditSemanticRoadNetwork(layout.roadNetwork);
  for (const marker of layout.siteMarkers) {
    if (marker.kind === "RUINED" && marker.targetTaskId) {
      throw new Error(`RUINED block-v1 marker ${marker.id} cannot target an active task`);
    }
    if (marker.kind === "RELOCATED" && !marker.targetTaskId) {
      throw new Error(`RELOCATED block-v1 marker ${marker.id} must target the canonical task`);
    }
  }
  await transaction(db, async () => {
    await db.prepare("SELECT pg_advisory_xact_lock(hashtext(?))")
      .get(`block-v1:${layout.cityId}:${layout.revision}`);
    const existing = await db.prepare("SELECT status,checksum FROM city_layouts_v1 WHERE id=? FOR UPDATE")
      .get<StoredLayout>(layout.id);
    if (existing) {
      if (existing.checksum !== layout.checksum || !["READY", "ACTIVE", "SUPERSEDED"].includes(existing.status)) {
        throw new Error(`Block-v1 layout ${layout.id} already exists with different content or lifecycle state`);
      }
      return;
    }

    await db.prepare(`INSERT INTO city_layouts_v1
      (id,country_id,city_id,generator_version,seed,revision,status,bounds_json,created_at,updated_at)
      VALUES (?,?,?,?,?,?,'GENERATING',?::jsonb,?,?)`)
      .run(layout.id, layout.countryId, layout.cityId, layout.generatorVersion, layout.seed, layout.revision,
        JSON.stringify(layout.bounds), timestamp, timestamp);
    for (const district of layout.districtLayouts) {
      await db.prepare(`INSERT INTO district_layouts_v1
        (id,layout_id,district_id,sequence,archetype,bounds_json,created_at)
        VALUES (?,?,?,?,?,?::jsonb,?)`)
        .run(district.id, layout.id, district.districtId, district.sequence, district.archetype,
          JSON.stringify(district.bounds), timestamp);
    }
    for (const block of layout.blocks) {
      await db.prepare(`INSERT INTO city_blocks_v1
        (id,layout_id,district_layout_id,sequence,kind,template_key,template_version,variant,seed,
         origin_x,origin_y,width,height,parameters_json,summary_json,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?::jsonb,?::jsonb,?)`)
        .run(block.id, layout.id, block.districtLayoutId, block.sequence, block.kind, block.templateKey,
          block.templateVersion, block.variant, block.seed, block.origin.x, block.origin.y, block.width, block.height,
          JSON.stringify(block.parameters), JSON.stringify(block.summary), timestamp);
    }
    for (const placement of layout.placements) {
      await db.prepare(`INSERT INTO task_placements_v1
        (task_id,layout_id,block_id,slot_key,building_family,facade_variant,construction_stage,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(placement.taskId, layout.id, placement.blockId, placement.slotKey, placement.buildingFamily,
          placement.facadeVariant, placement.constructionStage, timestamp, timestamp);
    }
    for (const marker of layout.siteMarkers) {
      await db.prepare(`INSERT INTO site_markers_v1
        (id,layout_id,block_id,slot_key,kind,target_task_id,snapshot_json,asset_variant,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?::jsonb,?,?,?)`)
        .run(marker.id, layout.id, marker.blockId, marker.slotKey, marker.kind, marker.targetTaskId ?? null,
          JSON.stringify(marker.snapshot), marker.assetVariant, timestamp, timestamp);
    }
    const { id: _networkId, checksum: _networkChecksum, ...network } = layout.roadNetwork;
    void _networkId; void _networkChecksum;
    await db.prepare(`INSERT INTO road_networks_v1
      (id,layout_id,schema_version,nodes_json,segments_json,checksum,created_at)
      VALUES (?,?,?,?::jsonb,?::jsonb,?,?)`)
      .run(layout.roadNetwork.id, layout.id, network.schemaVersion, JSON.stringify(network.nodes),
        JSON.stringify(network.segments), layout.roadNetwork.checksum, timestamp);
    await db.prepare("UPDATE city_layouts_v1 SET status='VALIDATING',updated_at=? WHERE id=?").run(timestamp, layout.id);
    await db.prepare("UPDATE city_layouts_v1 SET status='READY',checksum=?,updated_at=? WHERE id=?")
      .run(layout.checksum, timestamp, layout.id);
  });
}

export async function activateBlockLayout(db: Db, layoutId: string, timestamp: string): Promise<void> {
  await transaction(db, async () => {
    const candidate = await db.prepare("SELECT city_id FROM city_layouts_v1 WHERE id=?")
      .get<{ city_id: string }>(layoutId);
    if (!candidate) throw new Error(`Unknown block-v1 layout: ${layoutId}`);
    await db.prepare("SELECT pg_advisory_xact_lock(hashtext(?))").get(`block-v1:activate:${candidate.city_id}`);
    const layout = await db.prepare("SELECT city_id,status FROM city_layouts_v1 WHERE id=? FOR UPDATE")
      .get<{ city_id: string; status: string }>(layoutId);
    if (!layout) throw new Error(`Unknown block-v1 layout after activation lock: ${layoutId}`);
    if (layout.status === "ACTIVE") return;
    if (layout.status !== "READY") throw new Error(`Block-v1 layout ${layoutId} is not READY`);
    await db.prepare("UPDATE city_layouts_v1 SET status='SUPERSEDED',updated_at=? WHERE city_id=? AND status='ACTIVE'")
      .run(timestamp, layout.city_id);
    await db.prepare("UPDATE city_layouts_v1 SET status='ACTIVE',activated_at=?,updated_at=? WHERE id=?")
      .run(timestamp, timestamp, layoutId);
  });
}
