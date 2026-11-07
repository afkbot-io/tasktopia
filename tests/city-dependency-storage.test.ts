import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {expect,it} from 'vitest';

it('does not retain text copies of10k immutable task footprints and activity dependencies',async()=>{
  const samples:Array<{label:string;tasks:number;bytes:number}>=[];
  // Fresh processes avoid liveness of a preceding sample's closure or WeakMap
  // ephemerons contaminating the next baseline. Compare3 alternating pairs.
  for(let pair=0;pair<3;pair++)for(const label of pair%2?['new','old']:['old','new']){
    const {stdout}=await promisify(execFile)(process.execPath,
      ['--expose-gc','--import','tsx','tests/helpers/city-dependency-storage-probe.ts',label],
      {cwd:process.cwd(),env:{...process.env,NODE_OPTIONS:''},timeout:10_000,maxBuffer:4096});
    const result=JSON.parse(stdout) as typeof samples[number];
    expect(result.tasks).toBe(10_000);expect(result.bytes).toBeGreaterThan(0);samples.push(result);
  }
  const median=(values:number[])=>values.toSorted((a,b)=>a-b)[1]!;
  const oldBytes=median(samples.filter(s=>s.label==='old').map(s=>s.bytes));
  const newBytes=median(samples.filter(s=>s.label==='new').map(s=>s.bytes));
  expect(newBytes).toBeLessThan(8*1024*1024);
  expect(oldBytes-newBytes).toBeGreaterThan(10*1024*1024);
},20_000);
