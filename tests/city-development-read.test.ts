import { expect, it } from "vitest";
import { compileBlockLayout } from "../src/server/world/block-layout-compiler";
import { cityDevelopment } from "../src/server/city-development-read";
it("shows the full catalog in an empty city and reflects real reservations and stages", () => {
  expect(cityDevelopment().landmarks).toHaveLength(20);
  expect(cityDevelopment().landmarks.every(l=>l.state==="UNDISCOVERED")).toBe(true);
  const layout=compileBlockLayout({ countryId:"c",cityId:"city",seed:123,revision:1,
    districts:[{id:"d",archetype:"MIXED_URBAN",sequence:0,tasks:Array.from({length:28},(_,i)=>({id:`t${i}`,taskNumber:i+1,buildingFamily:"residential",facadeVariant:"south",constructionStage:5 as const}))}] });
  const before=JSON.stringify(layout);
  const dto=cityDevelopment(layout);
  expect(JSON.stringify(layout)).toBe(before);
  expect(dto.services.some(s=>s.role==="EDUCATION"&&s.state==="READY")).toBe(true);
  expect(dto.landmarks).toHaveLength(20);
  expect(dto.services.every(service => service.districtId === "d")).toBe(true);
  const service=dto.services.find(s=>s.taskId)!;
  const placement=layout.placements.find(p=>p.taskId===service.taskId)!;
  placement.constructionStage=4;
  expect(cityDevelopment(layout).services.find(s=>s.taskId===service.taskId)?.state).toBe("TESTING");
  layout.placements=layout.placements.filter(p=>p.taskId!==service.taskId);
  layout.siteMarkers.push({ id:"removed",blockId:placement.blockId,slotKey:placement.slotKey,kind:"RUINED",snapshot:{buildingFamily:placement.buildingFamily},assetVariant:"ruin" });
  expect(cityDevelopment(layout).services.find(s=>s.trigger===service.trigger)?.state).toBe("HISTORICAL");
});
