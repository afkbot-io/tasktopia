import { expect, it } from 'vitest';
import { planetLabelDetail, planetMiniatureScales } from '../src/client/planet-presentation';
import { projectPlanetAtlas, type ProjectedPlanetAtlas } from '../src/shared/planet-atlas';

it('показывает подписи только на своём уровне приближения',()=>{
 expect([.82,1,1.24].map(planetLabelDetail)).toEqual(['NONE','NONE','NONE']);
 expect([1.25,2,2.59].map(planetLabelDetail)).toEqual(['COUNTRIES','COUNTRIES','COUNTRIES']);
 expect([2.6,3,8.5].map(planetLabelDetail)).toEqual(['CITIES','CITIES','CITIES']);
});
it('дома занимают малую долю клетки и оставляют зазор между соседями',()=>{
 const atlas={hexRadius:8,countries:[{districtIcons:[{id:'a',point:{x:12,y:20}},{id:'b',point:{x:14,y:20}},{id:'c',point:{x:40,y:40}}]}]} as ProjectedPlanetAtlas;
 const scales=planetMiniatureScales(atlas);
 expect(scales.get('c')!*12).toBeLessThanOrEqual(16*.4);
 expect((scales.get('a')!+scales.get('b')!)*6).toBeLessThan(2);
 expect(planetMiniatureScales(atlas)).toEqual(scales);
});
it('облака имеют независимые координаты без диагональных цепочек',()=>{
 for(const planetSeed of [1,42,12345,918273]){
  const atlas={schemaVersion:4 as const,planetSeed,revision:'clouds',countries:[]};
  const map=projectPlanetAtlas(atlas),clouds=map.clouds;
  const x=clouds.map(c=>c.x/map.width),y=clouds.map(c=>c.y/map.height);
  const avg=(v:number[])=>v.reduce((a,b)=>a+b,0)/v.length;
  const ax=avg(x),ay=avg(y);
  const correlation=x.reduce((n,v,i)=>n+(v-ax)*(y[i]!-ay),0)/Math.sqrt(x.reduce((n,v)=>n+(v-ax)**2,0)*y.reduce((n,v)=>n+(v-ay)**2,0));
  expect(Math.abs(correlation)).toBeLessThan(.55);
  expect(new Set(clouds.map(c=>`${Math.floor(c.x/map.width*3)}:${Math.floor(c.y/map.height*3)}`)).size).toBeGreaterThanOrEqual(7);
  expect(projectPlanetAtlas(atlas).clouds).toEqual(clouds);
 }
});
