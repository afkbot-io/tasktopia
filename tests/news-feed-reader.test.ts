import { afterEach, describe, expect, it, vi } from 'vitest';
import { markNewsRead, readNewsPage, type NewsTransport } from '../src/client/news-feed-reader';
import type { CityNews } from '../src/shared/city-news';
const empty:CityNews={items:[],unreadCount:0,nextBefore:null,nextCursor:null};
afterEach(()=>vi.useRealTimers());
describe('explicit scoped news read',()=>{
  it('sends fifty rows, exact kind and opaque cursor without legacy before',async()=>{
    let url='';const send:NewsTransport=async<T>(path:string)=>{url=path;return empty as T;};
    await readNewsPage({countryId:'country',history:true,kind:'COMMENT',cursor:'opaque'},new AbortController().signal,send);
    expect(Object.fromEntries(new URL(url,'http://localhost').searchParams)).toEqual({countryId:'country',history:'true',limit:'50',kind:'COMMENT',cursor:'opaque'});
  });
  it('rejects invalid acknowledgement ids before a write',async()=>{
    let writes=0;const send:NewsTransport=async<T>()=>{writes++;return {ok:true} as T;};
    await expect(markNewsRead('country',[0],new AbortController().signal,send)).rejects.toThrow('eventIds');expect(writes).toBe(0);
  });
});

it('bounds hung GET and POST to fifteen seconds and cancels the transport',async()=>{
  vi.useFakeTimers();const signals:AbortSignal[]=[],results=vi.fn();
  const send:NewsTransport=async<T>(_path:string,init:{signal:AbortSignal})=>{signals.push(init.signal);return new Promise<T>(()=>undefined);};
  void readNewsPage({countryId:'country',history:false},new AbortController().signal,send).then(results,results);
  void markNewsRead('country',[23],new AbortController().signal,send).then(results,results);
  await vi.advanceTimersByTimeAsync(15001);expect(results).toHaveBeenCalledTimes(2);expect(signals.every(signal=>signal.aborted)).toBe(true);expect(vi.getTimerCount()).toBe(0);
});

it('does not acknowledge a successful HTTP response without an explicit receipt',async()=>{
  const send:NewsTransport=async<T>()=>({} as T);
  await expect(markNewsRead('country',[23],new AbortController().signal,send)).rejects.toThrow('прочтение');
});

it('cancels GET and POST immediately when the owning country is disposed',async()=>{
  const controller=new AbortController(),signals:AbortSignal[]=[];
  const send:NewsTransport=async<T>(_path:string,init:{signal:AbortSignal})=>{signals.push(init.signal);return new Promise<T>(()=>undefined);};
  const reads=readNewsPage({countryId:'country',history:false},controller.signal,send);
  const writes=markNewsRead('country',[23],controller.signal,send);
  const settled=Promise.allSettled([reads,writes]);await Promise.resolve();controller.abort();
  expect((await settled).every(result=>result.status==='rejected'&&result.reason instanceof DOMException&&result.reason.name==='AbortError')).toBe(true);
  expect(signals.every(signal=>signal.aborted)).toBe(true);
});
