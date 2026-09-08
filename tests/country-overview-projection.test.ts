import { describe, expect, it } from "vitest";
import { compileBlockLayout } from "../src/server/world/block-layout-compiler";
import { projectCountryCityMiniature, projectCountryOverview } from "../src/server/world/country-overview";

describe("semantic country projection", () => {
  it("preserves city relative distances and creates no synthetic transport", () => {
    const map = projectCountryOverview([{id:"a",sourceCenter:{x:0,y:0}},{id:"b",sourceCenter:{x:100,y:0}},{id:"c",sourceCenter:{x:300,y:0}}]);
    expect((map.centers.get("b")!.x-map.centers.get("a")!.x)/(map.centers.get("c")!.x-map.centers.get("a")!.x)).toBeCloseTo(1/3);
    expect(map.connections).toEqual([]);
  });
  it("projects precisely one icon per occupied canonical block, with no invented airport", () => {
    const layout = compileBlockLayout({countryId:"country",cityId:"city",seed:18,revision:1,origin:{x:0,y:0},
      districts:[{id:"district",archetype:"MIXED_URBAN",sequence:0,tasks:Array.from({length:30},(_,i)=>({
        id:"task-"+i,taskNumber:i+1,buildingFamily:"compact-apartment-v1",facadeVariant:"south",constructionStage:5 as const,autoVisualKind:true,
      }))}]});
    const first = projectCountryCityMiniature({sourceBounds:layout.bounds,layout});
    expect(first.blocks).toHaveLength(new Set(layout.placements.map(p=>p.blockId)).size);
    expect(first.airports).toEqual([]);
    expect(new Set(first.blocks.map(b=>b.id)).size).toBe(first.blocks.length);
    expect(first).toEqual(projectCountryCityMiniature({sourceBounds:layout.bounds,layout}));
    const placement=layout.placements[0]!;
    placement.serviceRole="AIRPORT"; placement.constructionStage=4;
    expect(projectCountryCityMiniature({sourceBounds:layout.bounds,layout}).airports).toEqual([]);
    placement.constructionStage=5;
    expect(projectCountryCityMiniature({sourceBounds:layout.bounds,layout}).airports).toHaveLength(1);
    placement.serviceRole="RAILWAY"; placement.constructionStage=4;
    expect(projectCountryCityMiniature({sourceBounds:layout.bounds,layout}).stations).toEqual([]);
    placement.constructionStage=5;
    const served=projectCountryCityMiniature({sourceBounds:layout.bounds,layout});
    expect(served.stations).toHaveLength(1); expect(served.airports).toEqual([]);
    expect(JSON.stringify(first)).not.toMatch(/districtCodes|coverageCodes|terrainCodes|footprint/);
  });
  it("does not fabricate a built core before the first task", () => {
    expect(projectCountryCityMiniature({sourceBounds:{minX:0,minY:0,maxX:160,maxY:96},layout:null})).toMatchObject({blocks:[],airports:[]});
  });
});
