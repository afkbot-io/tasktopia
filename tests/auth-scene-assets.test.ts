import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadAuthSceneAssets, type AuthSceneAssetState, type AuthSceneImage } from '../src/client/auth-scene-assets';

class Picture implements AuthSceneImage {
  src=''; decoding:AuthSceneImage['decoding']='auto';fetchPriority:AuthSceneImage['fetchPriority']='auto';
  onload:AuthSceneImage['onload']=null;onerror:AuthSceneImage['onerror']=null;
  removed=false;
  removeAttribute(name:string){if(name==='src'){this.src='';this.removed=true;}}
  load(){this.onload?.call(this as unknown as HTMLImageElement,new Event('load'));}
  fail(){this.onerror?.call(this as unknown as HTMLImageElement,new Event('error'));}
}
afterEach(()=>vi.useRealTimers());
describe('progressive decorative authentication assets',()=>{
  it('publishes drawable resources while a different image remains pending',()=>{
    const pictures:Picture[]=[],states:AuthSceneAssetState<Picture>[]=[];
    const dispose=loadAuthSceneAssets({urls:['road.png','house.png'],imageFactory:()=>{const picture=new Picture();pictures.push(picture);return picture;},onProgress:state=>states.push(state)});
    pictures[0]!.load();
    expect(states.at(-1)!.loaded.get('road.png')).toBe(pictures[0]);
    expect(states.at(-1)!.pending).toBe(1);
    expect(states.at(-1)!.total).toBe(2);
    dispose();
  });
  it('settles a hung image within four seconds and ignores its late completion',()=>{
    vi.useFakeTimers();
    const pictures:Picture[]=[],states:AuthSceneAssetState<Picture>[]=[];
    const dispose=loadAuthSceneAssets({urls:['road.png','hung-house.png'],imageFactory:()=>{const picture=new Picture();pictures.push(picture);return picture;},onProgress:state=>states.push(state)});
    const late=()=>pictures[1]!.load();
    pictures[0]!.load();vi.advanceTimersByTime(4000);
    expect(states.at(-1)!.pending).toBe(0);expect(states.at(-1)!.failed).toBe(1);
    expect(states.at(-1)!.timedOut).toBe(1);expect(states.at(-1)!.loaded.size).toBe(1);
    const count=states.length;late();expect(states).toHaveLength(count);
    expect(pictures[1]!.removed).toBe(true);dispose();expect(vi.getTimerCount()).toBe(0);
  });
  it('reserves request capacity for the form and bounds the whole scene even when every PNG hangs',()=>{
    vi.useFakeTimers();const pictures:Picture[]=[],states:AuthSceneAssetState<Picture>[]=[];
    const dispose=loadAuthSceneAssets({urls:Array.from({length:20},(_,i)=>`image-${i}.png`),imageFactory:()=>{const picture=new Picture();pictures.push(picture);return picture;},onProgress:state=>states.push(state)});
    expect(pictures).toHaveLength(4);
    expect(pictures.every(image=>image.fetchPriority==='low'&&image.decoding==='async')).toBe(true);
    vi.advanceTimersByTime(6000);
    expect(states.at(-1)).toMatchObject({total:20,pending:0,failed:20,timedOut:20});
    expect(pictures.length).toBeLessThanOrEqual(8);expect(pictures.every(image=>image.removed)).toBe(true);
    dispose();expect(vi.getTimerCount()).toBe(0);
  });
  it('cancels pending requests and queued callbacks after the form leaves',()=>{
    vi.useFakeTimers();const pictures:Picture[]=[],states:AuthSceneAssetState<Picture>[]=[];
    const dispose=loadAuthSceneAssets({urls:['grass.png','road.png','house.png'],imageFactory:()=>{const picture=new Picture();pictures.push(picture);return picture;},onProgress:state=>states.push(state)});
    const late=pictures[0]!.onload;const before=states.length;dispose();
    late?.call(pictures[0] as unknown as HTMLImageElement,new Event('load'));vi.advanceTimersByTime(6000);
    expect(states).toHaveLength(before);expect(vi.getTimerCount()).toBe(0);
    expect(pictures.every(image=>image.removed&&image.onload===null&&image.onerror===null)).toBe(true);
  });
  it('deduplicates a shared native tile and settles errors exactly once',()=>{
    vi.useFakeTimers();const pictures:Picture[]=[],states:AuthSceneAssetState<Picture>[]=[];
    const dispose=loadAuthSceneAssets({urls:['grass.png','grass.png'],imageFactory:()=>{const picture=new Picture();pictures.push(picture);return picture;},onProgress:state=>states.push(state)});
    expect(pictures).toHaveLength(1);const failed=pictures[0]!.onerror;pictures[0]!.fail();
    failed?.call(pictures[0] as unknown as HTMLImageElement,new Event('error'));vi.advanceTimersByTime(6000);
    expect(states.at(-1)).toMatchObject({total:1,pending:0,failed:1,timedOut:0});
    expect(vi.getTimerCount()).toBe(0);dispose();
  });
});
