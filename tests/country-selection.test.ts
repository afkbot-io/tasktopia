import { expect, it, vi, afterEach } from 'vitest';
import { CountrySelectionQueue, selectCountrySession } from '../src/client/country-selection';
it('последний выбор подтверждается после предыдущего, включая ошибку запроса',async()=>{
  const queue=new CountrySelectionQueue(),writes:string[]=[];
  let finish!:(value:string)=>void;
  const a=queue.select(()=>{writes.push('a');return new Promise<string>(resolve=>{finish=resolve;});});
  const b=queue.select(async()=>{writes.push('b');throw new Error('offline');});
  const c=queue.select(async()=>{writes.push('c');return 'c';});
  expect(queue.pending).toBe(true);await Promise.resolve();expect(writes).toEqual(['a']);
  finish('a');expect(await a).toBe('a');await expect(b).rejects.toThrow('offline');
  expect(await c).toBe('c');expect(writes).toEqual(['a','b','c']);expect(queue.pending).toBe(false);
});

afterEach(()=>vi.unstubAllGlobals());
it('сбрасывает отложенные выборы при смене сессии, не задерживая новый вход',async()=>{
  const queue=new CountrySelectionQueue(),writes:string[]=[];
  let release!:(value:string)=>void;
  const running=queue.select(()=>{writes.push('old');return new Promise<string>(resolve=>{release=resolve;});});
  const obsolete=queue.select(async()=>{writes.push('obsolete');return 'obsolete';});
  const rejected=expect(obsolete).rejects.toMatchObject({name:'AbortError'});
  await Promise.resolve();
  queue.invalidate();
  expect(queue.pending).toBe(false);
  const fresh=queue.select(async()=>{writes.push('fresh');return 'fresh';});
  expect(await fresh).toBe('fresh');
  expect(queue.pending).toBe(false);
  release('old');
  expect(await running).toBe('old');
  await rejected;
  expect(writes).toEqual(['old','fresh']);
  expect(queue.pending).toBe(false);
});
it('сверяет потерянный ответ выбора с сессией без повторного POST',async()=>{
  const fetcher=vi.fn().mockRejectedValueOnce(new TypeError('connection lost')).mockResolvedValueOnce(new Response(JSON.stringify({country:{id:'target'}}),{status:200}));
  vi.stubGlobal('fetch',fetcher);
  expect((await selectCountrySession('target')).country.id).toBe('target');
  expect(fetcher.mock.calls.map(args=>[args[0],args[1]?.method??'GET'])).toEqual([['/api/countries/target/select','POST'],['/api/bootstrap','GET']]);
});
it('не подменяет отказ доступа и не считает другую страну успешным выбором',async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce(new Response('{}',{status:403}));vi.stubGlobal('fetch',fetcher);
  await expect(selectCountrySession('forbidden')).rejects.toMatchObject({status:403});expect(fetcher).toHaveBeenCalledTimes(1);
  fetcher.mockReset().mockResolvedValueOnce(new Response('{}',{status:503})).mockResolvedValueOnce(new Response(JSON.stringify({country:{id:'previous'}}),{status:200}));
  await expect(selectCountrySession('target')).rejects.toMatchObject({status:503});expect(fetcher).toHaveBeenCalledTimes(2);
});
