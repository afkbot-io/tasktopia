import { describe, expect, it } from "vitest";
import { atlasRailRoutes, atlasShipRoutes } from "../src/shared/atlas-grid-transport";
const land = [{x:0,y:0},{x:1,y:0},{x:2,y:0},{x:2,y:1},{x:0,y:1}];
const stops = [{id:"a",cityId:"a",cell:{x:0,y:1}},{id:"b",cityId:"b",cell:{x:2,y:1}},{id:"c",cityId:"c",cell:{x:9,y:9}}];
describe("atlas transport", () => {
  it("connects stations over land around water and leaves other continents disconnected", () => {
    const routes=atlasRailRoutes(stops,[...land,{x:9,y:9}]);
    expect(routes).toHaveLength(1); expect(routes[0]!.cells).toHaveLength(5);
    expect(routes[0]!.cells).not.toContainEqual({x:1,y:1});
    expect(atlasRailRoutes([...stops].reverse(),land)).toEqual(routes);
  });
  it("does not invent a railway without stations", () => {expect(atlasRailRoutes([],land)).toEqual([]);});
  it("ships use water cells around an intervening island", () => {
    const ocean=Array.from({length:21},(_,i)=>({x:i%7,y:Math.floor(i/7)})).filter(c=>!((c.x===0||c.x===3||c.x===6)&&c.y===1));
    const routes=atlasShipRoutes(new Map([[0,[{x:0,y:1}]],[1,[{x:6,y:1}]]]),ocean);
    expect(routes).toHaveLength(1);
    for(const cell of routes[0]!)expect(ocean).toContainEqual(cell);
  });
});
