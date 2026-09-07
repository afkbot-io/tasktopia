import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { compileBlockLayout } from "../src/server/world/block-layout-compiler";
import { auditBlockLayout, auditWorld, type BlockAuditTask } from "../src/server/world/world-audit";
import { createTestDb } from "../src/server/db";
import { registerUser } from "../src/server/auth";
import type { AppService } from "../src/server/app-service";

const source: BlockAuditTask[] = [{ id: "task", districtId: "district", constructionStage: 3, kind: "BUILDING", buildingFamily: "compact-apartment-v1" }];
const compile = () => compileBlockLayout({
  countryId: "country", cityId: "city", seed: 1, revision: 1,
  districts: [{ id: "district", sequence: 0, archetype: "MIXED_URBAN", tasks: [{
    id: "task", taskNumber: 1, constructionStage: 3, buildingFamily: "compact-apartment-v1", requestedFamily: "compact-apartment-v1", facadeVariant: "south",
  }] }],
});

describe("canonical block-world audit", () => {
  it("reports a required cutover layout on the migrated database without reading removed spatial tables", async () => {
    const db = await createTestDb();
    try {
      const { user } = await registerUser(db, { email: "block-audit@tasktopia.local", name: "Audit", password: "audit-password" });
      const id = randomUUID();
      await db.prepare(`INSERT INTO cities_v3 (id,country_id,name,status,center_x,center_y,bounds_json,style_id,created_at)
        VALUES (?,?,'Audit city','ACTIVE',0,0,?::jsonb,'block-v1',?)`)
        .run(id, user.countryId, JSON.stringify({ minX: 0, minY: 0, maxX: 32, maxY: 32 }), new Date().toISOString());
      const audit = await auditWorld(db, {} as AppService, user.countryId);
      expect(audit.metrics.cities).toBe(1);
      expect(audit.violations).toEqual([{ code: "WORLD_REGENERATION_REQUIRED", message: "Audit city: no active block-v1 layout" }]);
    } finally { await db.close(); }
  });

  it("accepts compact slots, full-width roads and reachable planned sites without any legacy rows", () => {
    expect(auditBlockLayout(compile(), source, () => true)).toEqual([]);
  });

  it("detects missing task conservation and stale construction stage", () => {
    const missing = compile(); missing.placements = [];
    expect(auditBlockLayout(missing, source).map((v) => v.code)).toContain("TASK_PLACEMENT_MISSING");
    const stale = compile(); stale.placements[0]!.constructionStage = 5;
    expect(auditBlockLayout(stale, source).map((v) => v.code)).toContain("TASK_STAGE_MISMATCH");
  });

  it("rejects wrong district and wrong predefined slot type", () => {
    const layout = compile();
    expect(auditBlockLayout(layout, [{ ...source[0]!, districtId: "another", kind: "PARK" }]).map((v) => v.code))
      .toEqual(expect.arrayContaining(["TASK_DISTRICT_MISMATCH", "TASK_SLOT_KIND_MISMATCH"]));
  });

  it("detects occupied site markers and duplicate task assignments", () => {
    const layout = compile();
    layout.placements.push({ ...layout.placements[0]! });
    layout.siteMarkers.push({ id: "marker", blockId: layout.blocks[0]!.id, slotKey: "slot-0", kind: "RUINED", snapshot: {}, assetVariant: "ruin" });
    expect(auditBlockLayout(layout, source).map((v) => v.code))
      .toEqual(expect.arrayContaining(["SLOT_OCCUPANCY_CONFLICT", "DUPLICATE_TASK_PLACEMENT"]));
  });

  it("detects a moved block that overlaps a road and loses sidewalk access", () => {
    const layout = compile(); layout.blocks[0]!.origin.x += 5; layout.blocks[0]!.origin.y += 5;
    expect(auditBlockLayout(layout, source).map((v) => v.code))
      .toEqual(expect.arrayContaining(["BLOCK_GRID_MISALIGNED", "TASK_ENTRANCE_UNREACHABLE"]));
  });

  it("rejects disconnected road topology before attempting a raster", () => {
    const layout = compile(); layout.roadNetwork.nodes.push({ id: "detached", x: 500, y: 500 });
    expect(auditBlockLayout(layout, source).map((v) => v.code)).toContain("ROAD_NETWORK_INVALID");
  });

  it("checks terrain separately from topology instead of repainting water as grass", () => {
    const layout = compile();
    expect(auditBlockLayout(layout, source, (p) => p.x > 1).map((v) => v.code)).toContain("ROAD_ON_UNBUILDABLE_TERRAIN");
    expect(auditBlockLayout(layout, source, (p) => p.x !== 6 || p.y !== 6).map((v) => v.code)).toContain("SITE_ON_UNBUILDABLE_TERRAIN");
  });
});
