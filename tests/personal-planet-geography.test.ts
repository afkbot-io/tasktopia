import { expect,it } from "vitest";
import { createTestDb } from "../src/server/db";
import { registerUser } from "../src/server/auth";
import { readOrExtendPersonalPlanet } from "../src/server/personal-planet-geography";
import type { PlanetAtlasDto } from "../src/shared/planet-atlas-contract";
it("serializes first import, preserves reserves and rolls back an exhausted extension",async()=>{
  const db=await createTestDb();
  try {
    const {user}=await registerUser(db,{email:"geography@example.test",name:"Geography",password:"password123"});
    const atlas:PlanetAtlasDto={schemaVersion:4,planetSeed:12,revision:"one",countries:[{id:"country-a",name:"A",seed:44,worldVersion:1,cityCount:0,districtCount:0,buildingCount:0,unfinishedBuildingCount:0,progress:0,worldBounds:null,cities:[]}]};
    const [first,second]=await Promise.all([readOrExtendPersonalPlanet(db,user.id,atlas),readOrExtendPersonalPlanet(db,user.id,atlas)]);
    expect(first).toEqual(second);
    expect((await db.prepare("SELECT count(*)::int AS count FROM personal_planet_geography_v1 WHERE user_id=?").get<{count:number}>(user.id))!.count).toBe(1);
    expect(await readOrExtendPersonalPlanet(db,user.id,{...atlas,countries:[]})).toEqual(first);
    const tiny={...first,width:16,height:16};
    await db.prepare("UPDATE personal_planet_geography_v1 SET geography_json=?::jsonb WHERE user_id=?").run(JSON.stringify(tiny),user.id);
    await expect(readOrExtendPersonalPlanet(db,user.id,{...atlas,countries:[...atlas.countries,{...atlas.countries[0]!,id:"country-b"}]})).rejects.toThrow("не осталось места");
    expect((await db.prepare("SELECT geography_json FROM personal_planet_geography_v1 WHERE user_id=?").get<{geography_json:unknown}>(user.id))!.geography_json).toEqual(tiny);
  }finally{await db.close();}
});
