import { expect, it } from 'vitest';
import { AdaptiveWorldQuality } from '../src/client/adaptive-world-quality';
const advance=(quality:AdaptiveWorldQuality,ms:number,frame:number)=>{for(let t=0;t<ms;t+=frame)quality.sample(frame,true);};
it('автоматически облегчает мир за четыре секунды устойчивого давления и восстанавливает без колебаний',()=>{
  const q=new AdaptiveWorldQuality();advance(q,4000,40);expect(q.economy).toBe(true);
  advance(q,18000,16);expect(q.economy).toBe(true);
  advance(q,8000,16);expect(q.economy).toBe(false);
});
it('одна задержка и загрузка не переключают профиль',()=>{
  const q=new AdaptiveWorldQuality();advance(q,2000,16);q.sample(180,true);advance(q,6000,16);expect(q.economy).toBe(false);
  for(let i=0;i<100;i++)q.sample(40,false);expect(q.economy).toBe(false);
});

it('возвращает полную детализацию после стабильной работы при собственном лимите 30 FPS',()=>{
 const q=new AdaptiveWorldQuality();advance(q,4000,40);expect(q.economy).toBe(true);
 for(let i=0;i<800;i++)q.sample(1000/30,true,1000/30);expect(q.economy).toBe(false);
});
