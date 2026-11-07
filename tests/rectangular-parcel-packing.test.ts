import { describe, expect, it } from "vitest";
import { packBuildingParcels } from "../src/shared/block-parcel-plan";

const shapes = [{ family: "long", width: 18, height: 6 }, { family: "tall", width: 6, height: 12 },
  { family: "small", width: 6, height: 3 }];

describe("rectangular building parcels", () => {
  it.each(["NW", "NE", "SW", "SE"] as const)("packs independent width/depth from %s without rotating artwork", corner => {
    for (const firstFamily of ["long", "tall"]) {
      const input = { width: 32, height: 32, seed: 47, corner, shapes, firstFamily };
      const result = packBuildingParcels(input);
      expect(result).toEqual(packBuildingParcels(input));
      expect(result[0]).toMatchObject({ family: firstFamily, width: firstFamily === "long" ? 18 : 6,
        height: firstFamily === "long" ? 6 : 12, clearance: 1 });
      const occupied = new Set<string>();
      for (const site of result) {
        expect(site.x).toBeGreaterThanOrEqual(3); expect(site.y).toBeGreaterThanOrEqual(3);
        expect(site.x + site.width + 2 * site.clearance).toBeLessThanOrEqual(30);
        expect(site.y + site.height + 2 * site.clearance).toBeLessThanOrEqual(30);
        for (let y = site.y; y < site.y + site.height + 2 * site.clearance; y++)
          for (let x = site.x; x < site.x + site.width + 2 * site.clearance; x++) {
            expect(occupied.has(`${x}:${y}`)).toBe(false); occupied.add(`${x}:${y}`);
          }
      }
      // A south gate must reach the exterior sidewalk without crossing a site.
      for (const site of result) {
        const start = { x: site.x + site.clearance + Math.floor(site.width / 2), y: site.y + site.height + site.clearance };
        const queue = [start], seen = new Set<string>(); let reached = false;
        for (let i = 0; i < queue.length; i++) {
          const p = queue[i]!;
          if (p.x === 2 || p.y === 2 || p.x === 30 || p.y === 30) { reached = true; break; }
          for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1]]) {
            const x = p.x + dx!, y = p.y + dy!, key = `${x}:${y}`;
            if (x < 2 || y < 2 || x > 30 || y > 30 || occupied.has(key) || seen.has(key)) continue;
            seen.add(key); queue.push({ x, y });
          }
        }
        expect(reached).toBe(true);
      }
    }
  });
  it("varies the first building proportion across seeds", () => {
    const first = Array.from({length: 24}, (_, seed) => packBuildingParcels({width:32,height:32,seed,corner:"NW",shapes})[0]!);
    expect(new Set(first.map(p => p.family)).size).toBe(3);
  });
  it.each(['NW','NE','SW','SE'] as const)('keeps requested identity and usable south gates around public reservations from %s', corner => {
    const reserved={minX:12,minY:12,maxX:15,maxY:15};
    const parcels=packBuildingParcels({width:32,height:32,seed:47,corner,shapes,firstFamily:'long',publicReservations:[reserved]});
    expect(parcels[0]!.family).toBe('long');
    const blocked=new Set<string>();
    for(let y=reserved.minY;y<=reserved.maxY;y++)for(let x=reserved.minX;x<=reserved.maxX;x++)blocked.add(`${x}:${y}`);
    for(const p of parcels)for(let y=p.y;y<p.y+p.height+2;y++)for(let x=p.x;x<p.x+p.width+2;x++){
      expect(blocked.has(`${x}:${y}`)).toBe(false);blocked.add(`${x}:${y}`);
    }
    for(const p of parcels){
      const start={x:p.x+1+Math.floor(p.width/2),y:p.y+p.height+1},pending=[start],seen=new Set<string>();let reached=false;
      for(let head=0;head<pending.length;head++){
        const c=pending[head]!;if(c.x===2||c.y===2||c.x===30||c.y===30){reached=true;break;}
        for(const [dx,dy] of [[0,1],[1,0],[-1,0],[0,-1]]){
          const x=c.x+dx!,y=c.y+dy!,id=`${x}:${y}`;
          if(x<2||x>30||y<2||y>30||blocked.has(id)||seen.has(id))continue;
          seen.add(id);pending.push({x,y});
        }
      }
      expect(reached).toBe(true);
    }
  });
  it("refuses an explicit first shape that cannot fit, rather than substituting a smaller house", () => {
    expect(() => packBuildingParcels({ width: 16, height: 16, seed: 0, corner: "NW", shapes, firstFamily: "long" })).toThrow(/fit/i);
  });
  it("selects a fitting default shape for a small block", () => {
    expect(packBuildingParcels({ width: 16, height: 16, seed: 0, corner: "NW", shapes })[0]).toMatchObject({ family: "small" });
  });
  it.each([0, -1, 1.5, Infinity, NaN])("rejects invalid shape dimensions %s", width => {
    expect(() => packBuildingParcels({ width: 32, height: 32, seed: 0, corner: "NW", shapes: [{ family: "bad", width, height: 6 }] })).toThrow();
  });
});
