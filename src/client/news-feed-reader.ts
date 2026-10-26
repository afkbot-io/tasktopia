import { CITY_NEWS_KINDS, type CityNews, type CityNewsKind } from '../shared/city-news';
import { api } from './api';
export type NewsPageQuery = {countryId:string;history:boolean;kind?:CityNewsKind;cursor?:string|null;limit?:number};
export type NewsTransport=<T>(path:string,init:{signal:AbortSignal;method?:'POST';json?:unknown})=>Promise<T>;
const transport:NewsTransport=(path,init)=>init.method==='POST'?api(path,{signal:init.signal,method:'POST',json:init.json}):api(path,{signal:init.signal});
async function bounded<T>(signal:AbortSignal,load:(signal:AbortSignal)=>Promise<T>):Promise<T>{
  signal.throwIfAborted();const controller=new AbortController(),cancel=()=>controller.abort(signal.reason);
  signal.addEventListener('abort',cancel,{once:true});
  let timer:ReturnType<typeof setTimeout>|undefined,abort:(()=>void)|undefined;
  try {
    return await Promise.race([Promise.resolve().then(()=>{controller.signal.throwIfAborted();return load(controller.signal);}),new Promise<never>((_resolve,reject)=>{
      abort=()=>reject(new DOMException('News request cancelled','AbortError'));controller.signal.addEventListener('abort',abort,{once:true});
      timer=setTimeout(()=>{reject(new Error('Не удалось получить ответ. Повторите попытку.'));controller.abort();},15000);
    })]);
  } finally {clearTimeout(timer);signal.removeEventListener('abort',cancel);if(abort)controller.signal.removeEventListener('abort',abort);}
}
export async function readNewsPage(query:NewsPageQuery,signal:AbortSignal,send:NewsTransport=transport):Promise<CityNews>{
  if(!query.countryId||!Number.isInteger(query.limit??50)||(query.limit??50)<1||(query.limit??50)>50)throw new Error('Некорректный запрос новостей');
  const params=new URLSearchParams({countryId:query.countryId,history:String(query.history),limit:String(query.limit??50)});
  if(query.kind)params.set('kind',query.kind);if(query.cursor)params.set('cursor',query.cursor);
  const page=await bounded(signal,requestSignal=>send<CityNews>(`/api/city-news?${params}`,{signal:requestSignal}));
  signal.throwIfAborted();
  if(!Array.isArray(page.items)||page.items.length>(query.limit??50)||!Number.isSafeInteger(page.unreadCount)||page.unreadCount<0
    ||page.items.some(item=>!Number.isSafeInteger(item.lastEventId)||item.lastEventId<=0||!CITY_NEWS_KINDS.includes(item.kind))
    ||(page.nextCursor!=null&&(typeof page.nextCursor!=='string'||!page.nextCursor||page.nextCursor===query.cursor)))throw new Error('Сервер вернул несовместимую страницу новостей');
  return page;
}
export async function markNewsRead(countryId:string,eventIds:readonly number[],signal:AbortSignal,send:NewsTransport=transport):Promise<void>{
  if(eventIds.length>50||eventIds.some(id=>!Number.isSafeInteger(id)||id<=0))throw new Error('Некорректные eventIds новостей');
  signal.throwIfAborted();
  if(!eventIds.length)return;
  const receipt=await bounded(signal,requestSignal=>send<{ok?:boolean}>('/api/city-news/read',{signal:requestSignal,method:'POST',json:{countryId,eventIds:[...new Set(eventIds)]}}));
  if(receipt?.ok!==true)throw new Error('Сервер не подтвердил прочтение. Повторите попытку.');
  signal.throwIfAborted();
}
