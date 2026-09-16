import {expect,it} from "vitest";
import {openOceanCells} from "../src/shared/ocean-connectivity";
it("keeps boundary-connected ocean but excludes enclosed lakes and diagonal-only contacts",()=>{
 const cells=[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:2,y:2},{x:3,y:3}];
 expect(openOceanCells(cells,{minX:0,minY:0,maxX:5,maxY:5})).toEqual(cells.slice(0,3));
});
it("does not treat missing data or an internal water patch as an ocean outlet",()=>{
 expect(openOceanCells([{x:2,y:2},{x:3,y:2}],{minX:0,minY:0,maxX:5,maxY:5})).toEqual([]);
 expect(openOceanCells([{x:-1,y:0},{x:0,y:0},{x:0,y:0}],{minX:0,minY:0,maxX:5,maxY:5})).toEqual([{x:0,y:0}]);
});
