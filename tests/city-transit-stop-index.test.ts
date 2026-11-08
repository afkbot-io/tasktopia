import { expect, it } from 'vitest';
import { canonicalTransitStop } from '../src/shared/city-transit-stops';
import * as transit from '../src/client/city-transit-stop-index';
it('shares one completed immutable-manifest index and never caches a cancelled partial preparation', async () => {
  const source = Array.from({length:8},(_,i)=>canonicalTransitStop(`b${i}`,{x:i*64,y:0},'E'));
  const first=transit.createTransitStopIndex(source);
  expect(transit.createTransitStopIndex(source)).toBe(first);
  const pending=source.slice(),controller=new AbortController();
  await expect(transit.prepareTransitStopIndexAsync(pending,{signal:controller.signal,maxOperations:1,yieldTask:async()=>{controller.abort();}})).rejects.toMatchObject({name:'AbortError'});
  expect(transit.createTransitStopIndex(pending).size).toBe(8);
  expect(await transit.prepareTransitStopIndexAsync(source)).toBe(first);
});

it('keeps all published definitions and bounds local render, line and shelter queries at 10000 stops', () => {
  const stops = Array.from({ length: 10000 },(_,i) => canonicalTransitStop(`b${i}`,{ x: (i%100)*64, y: Math.floor(i/100)*64 },'E'));
  const index = transit.createTransitStopIndex(stops);
  expect(index.size).toBe(10000);
  const view = { minX: 0, minY: 0, maxX: 160, maxY: 100 };
  const local = index.visible(view);
  expect(local.map(stop => stop.id)).toContain('stop:0,0');
  expect(local.length).toBeLessThanOrEqual(256);
  expect(index.visible(view)).toBe(local);
  const wide = index.visible({minX:8,minY:8,maxX:632,maxY:376});
  expect(wide.some(stop=>stop.id==='stop:0,64')).toBe(true);
  expect(wide.some(stop=>stop.id==='stop:576,64')).toBe(true);
  const nearby = index.nearby({ x: 0, y: 0 });
  expect(nearby.length).toBeLessThanOrEqual(16);expect(nearby[0]!.id).toBe('stop:0,0');
  expect(index.nearby({ x: 6300, y: 6300 }).some(stop => stop.id==='stop:6272,6272')).toBe(true);
  expect(index.isSheltered({ x: .5, y: 1.5 })).toBe(true);
  expect(index.isSheltered({ x: 30.5, y: 30.5 })).toBe(false);
  const remote = index.visible({ minX: 6200, minY: 6200, maxX: 6400, maxY: 6400 });
  expect(remote.some(stop => stop.id==='stop:6336,6336')).toBe(true);
  expect(index.byId.get('stop:0,0')!.shelter).toEqual(stops[0]!.shelter);
  expect(index.metrics.maxBuckets).toBeLessThanOrEqual(64);
  expect(index.metrics.maxVisited).toBeLessThanOrEqual(256);
});
