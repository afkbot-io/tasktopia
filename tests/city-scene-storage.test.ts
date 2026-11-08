import {expect,it} from 'vitest';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

it('packed immutable scene storage retains at least60% less run memory across three independent GC pairs',()=>{
  const helper=fileURLToPath(new URL('./helpers/city-run-storage-probe.ts',import.meta.url));
  const samples:{eager:number;packed:number}[]=[];
  for(let pair=0;pair<3;pair++){
    const values:{eager:number;packed:number}={eager:0,packed:0};
    for(const mode of pair%2?['packed','eager'] as const:['eager','packed'] as const){
      const value=JSON.parse(execFileSync(process.execPath,['--expose-gc','--import','tsx',helper,mode],{encoding:'utf8'})) as {mode:string;count:number;retainedBytes:number};
      expect(value.mode).toBe(mode);expect(value.count).toBe(50000);expect(value.retainedBytes).toBeGreaterThan(0);values[mode]=value.retainedBytes;
    }
    samples.push(values);
  }
  const median=(mode:'eager'|'packed')=>samples.map(pair=>pair[mode]).sort((a,b)=>a-b)[1]!;
  expect(median('packed'),JSON.stringify(samples)).toBeLessThanOrEqual(median('eager')*.4);
},20000);
