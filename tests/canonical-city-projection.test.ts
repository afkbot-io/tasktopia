import {expect,it} from "vitest";
import type {ChunkDto,ChunkPayloadDto} from "../src/shared/contracts";
import {CanonicalCityProjection} from "../src/client/canonical-city-projection";

const payload = (x: number) => ({chunkX:x,chunkY:0,contentHash:`h${x}`,publishedVersion:1,tasks:[],
  decorationContext:{tasks:[]}} as unknown as ChunkPayloadDto);
const chunk = (x: number) => ({chunkX:x,chunkY:0,tasks:[],worldVersion:1} as unknown as ChunkDto);

it("prepares one bounded physical page at a time and publishes only the whole snapshot",async()=>{
  const projection=new CanonicalCityProjection(),seen:number[]=[],releases:Array<()=>void>=[];
  const next=projection.prepare("one",[payload(0),payload(1)],[],async page=>{
    seen.push(page.chunkX);await new Promise<void>(resolve=>releases.push(resolve));return chunk(page.chunkX);
  });
  await Promise.resolve();
  expect(seen).toEqual([0]);
  expect(projection.pending).toBe(true);
  expect(projection.current.chunks).toEqual([]);
  releases.shift()!();await new Promise<void>(resolve=>setTimeout(resolve,0));
  expect(seen).toEqual([0,1]);expect(projection.current.chunks).toEqual([]);
  releases.shift()!();expect(await next).toBe(true);
  expect(projection.current.chunks.map(page=>page.chunkX)).toEqual([0,1]);
  expect(projection.pending).toBe(false);
});

it("retains the last complete city on failure and prevents late or disposed publication",async()=>{
  const projection=new CanonicalCityProjection();
  await projection.prepare("old",[payload(0)],[],async()=>chunk(0));
  const previous=projection.current;
  await expect(projection.prepare("failed",[payload(1)],[],async()=>{throw new Error("physical failed");})).rejects.toThrow("physical failed");
  expect(projection.current).toBe(previous);
  let release!:()=>void;
  const stale=projection.prepare("stale",[payload(2)],[],async()=>{await new Promise<void>(resolve=>{release=resolve;});return chunk(2);});
  await projection.prepare("new",[payload(3)],[],async()=>chunk(3));
  release();expect(await stale).toBe(false);
  expect(projection.current.chunks.map(page=>page.chunkX)).toEqual([3]);
  projection.dispose();
  expect(await projection.prepare("disposed",[payload(4)],[],async()=>chunk(4))).toBe(false);
});

it("clears a removed whole city and rejects an ignored late result after disposal",async()=>{
  const projection=new CanonicalCityProjection();
  await projection.prepare("one",[payload(0)],[],async()=>chunk(0));
  await projection.prepare("empty",[],[],async()=>{throw new Error("No page should be read");});
  expect(projection.current.chunks).toEqual([]);expect(projection.pending).toBe(false);
  let release!:()=>void;
  const pending=projection.prepare("late",[payload(1)],[],async()=>{await new Promise<void>(resolve=>{release=resolve;});return chunk(1);});
  projection.dispose();release();expect(await pending).toBe(false);
  expect(projection.current.chunks).toEqual([]);
});

it("reuses immutable physical content while applying fresh task metadata and removals",async()=>{
  const projection=new CanonicalCityProjection();let reads=0;
  const read=async(page:ChunkPayloadDto)=>{reads++;return chunk(page.chunkX);};
  await projection.prepare("one",[payload(0),payload(1)],[],read);
  const roads=projection.current.chunks[0]!.roads;
  const next={...payload(0),publishedVersion:2,tasks:[{id:"task",stage:3}]} as ChunkPayloadDto;
  await projection.prepare("two",[next],[],read);
  expect(reads).toBe(3); // Stage changes are physical, even under a pending realtime content hash.
  expect(projection.current.chunks).toHaveLength(1);
  await projection.prepare("metadata",[{...next,publishedVersion:3,tasks:[{...next.tasks[0]!,title:"renamed"}]}],[],read);
  expect(reads).toBe(3);
  expect(projection.current.chunks[0]!.tasks[0]!.title).toBe("renamed");
  expect(projection.current.chunks[0]!.roads).toBe(roads);
});

it("retains a ready suspended snapshot but keeps an interrupted same-scene patch pending for retry",async()=>{
  const projection=new CanonicalCityProjection();
  await projection.prepare("scene:1",[payload(0)],[],async()=>chunk(0));
  const previous=projection.current;
  projection.cancel();expect(projection.current).toBe(previous);expect(projection.pending).toBe(false);
  const patched={...payload(0),tasks:[{id:"task",stage:4}]} as ChunkPayloadDto;
  let release!:()=>void;
  const pending=projection.prepare("scene:2",[patched],[],async()=>{
    await new Promise<void>(resolve=>{release=resolve;});return chunk(0);
  });
  projection.cancel();release();expect(await pending).toBe(false);
  expect(projection.current).toBe(previous);expect(projection.pending).toBe(true);
  expect(await projection.prepare("scene:3",[patched],[],async()=>chunk(0))).toBe(true);
  expect(projection.current).not.toBe(previous);expect(projection.pending).toBe(false);
  expect(projection.current.chunks[0]!.tasks).toBe(patched.tasks);
});
