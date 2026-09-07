import { describe, expect, it } from "vitest";
import { AppService } from "../src/server/app-service";
import { registerUser } from "../src/server/auth";
import { createTestDb } from "../src/server/db";
import { readActiveBlockLayout } from "../src/server/world/active-block-layout";
import { projectCountryCityMiniature } from "../src/server/world/country-overview";
import { compileBlockLayout } from "../src/server/world/block-layout-compiler";
import { createDistrictTerritory } from "../src/client/district-territory";

describe("district navigation envelopes do not define territory", () => {
  it("COUNTRY preserves separate owned block icons even when their district encloses another district", () => {
    const layout = compileBlockLayout({ countryId: "country", cityId: "city", seed: 73, revision: 1,
      districts: ["a", "b"].map((id, sequence) => ({ id, sequence, archetype: "MIXED_URBAN", tasks: [{
        id: `task-${id}`, taskNumber: sequence + 1, buildingFamily: "compact-apartment-v1", facadeVariant: "south", constructionStage: 5 as const,
      }] })),
    });
    const first = layout.blocks.find(block => block.districtLayoutId === layout.districtLayouts[0]!.id)!;
    // Pure projection fixture: the far block belongs to A, although B lies
    // inside A's navigation envelope. Projection does not consume road data.
    const far = { ...first, id: "detached-a", sequence: 1, origin: { x: layout.bounds.maxX + 32, y: first.origin.y } };
    layout.blocks.push(far);
    layout.placements.push({ ...layout.placements.find(p => p.blockId === first.id)!, taskId: "task-a-detached", blockId: far.id });
    layout.bounds.maxX = far.origin.x + far.width;
    layout.districtLayouts[0]!.bounds = { ...layout.bounds };
    const miniature = projectCountryCityMiniature({ sourceBounds: layout.bounds, layout });
    expect(miniature.blocks.filter(block => block.districtId === "a").map(block => block.id)).toEqual([first.id, far.id]);
    const other = miniature.blocks.find(block => block.districtId === "b")!;
    expect(other.id).not.toBe(first.id);
    expect(miniature.blocks).toHaveLength(3);
    for (const icon of miniature.blocks) {
      const block = layout.blocks.find(block => block.id === icon.id)!;
      expect(icon.x * miniature.cellSize + layout.bounds.minX).toBe(block.origin.x + block.width / 2);
      expect(icon.y * miniature.cellSize + layout.bounds.minY).toBe(block.origin.y + block.height / 2);
    }
  });

  it("PLANET anchors each district in an occupied owned block, independent of overlapping navigation bounds", async () => {
    const db = await createTestDb();
    try {
      const { user } = await registerUser(db, { email: "detached-atlas@example.test", name: "Atlas QA", password: "password123" });
      await db.prepare("UPDATE countries SET seed=424242 WHERE id=?").run(user.countryId);
      const service = new AppService(db);
      const city = await service.createCity(user.countryId, { name: "Owned blocks", idempotencyKey: "city" });
      const districts = [];
      for (let index = 0; index < 2; index++) {
        const district = await service.createDistrict(user.countryId, { cityId: city.id, name: `Sprint ${index}`, idempotencyKey: `district-${index}` });
        districts.push(district);
        await service.createTask(user.countryId, { cityId: city.id, districtId: district.id, title: `Owned task ${index}`,
          visualKind: "BUILDING", estimate: 1, idempotencyKey: `task-${index}` });
      }
      const layout = (await readActiveBlockLayout(db, city.id))!;
      // Deliberately alter only disposable navigation metadata, never ownership.
      // A detached district can enclose B; the midpoint is not a district site.
      const navigationBounds = { ...layout.bounds, maxX: layout.bounds.maxX + 160 };
      await db.prepare("UPDATE districts_v3 SET spatial_bounds_json=?::jsonb WHERE id=?")
        .run(JSON.stringify(navigationBounds), districts[0]!.id);
      const atlas = await new AppService(db).getPlanetAtlas(user.id);
      const atlasCity = atlas.countries.find(c => c.id === user.countryId)!.cities.find(c => c.id === city.id)!;
      const miniature = projectCountryCityMiniature({ sourceBounds: layout.bounds, layout });
      for (const district of atlasCity.districts) {
        const districtLayout = layout.districtLayouts.find(d => d.districtId === district.id)!;
        const occupiedIds = new Set(layout.placements.map(p => p.blockId));
        const owned = layout.blocks.filter(b => b.districtLayoutId === districtLayout.id && occupiedIds.has(b.id))
          .sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id));
        const first = owned[0]!;
        expect(district.center).toEqual({ x: first.origin.x + first.width / 2, y: first.origin.y + first.height / 2 });
        const icon = miniature.blocks.find(b => b.id === first.id)!;
        expect(district.center).toEqual({ x: icon.x * miniature.cellSize + layout.bounds.minX, y: icon.y * miniature.cellSize + layout.bounds.minY });
        // This anchor is also inside the CITY semantic territory, not its bbox.
        const cells = owned.flatMap(block => Array.from({ length: block.height - 3 }, (_, y) =>
          Array.from({ length: block.width - 3 }, (_, x) => ({ x: block.origin.x + x + 2, y: block.origin.y + y + 2 }))).flat());
        const territory = createDistrictTerritory(cells, 8);
        expect(territory.contains(district.center.x * 8, district.center.y * 8)).toBe(true);
      }
    } finally { await db.close(); }
  }, 30_000);
});
