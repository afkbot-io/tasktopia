import type { CityNews, CityNewsItem } from '../shared/city-news';
export const newsItemKey=(item:Pick<CityNewsItem,'taskId'|'kind'|'lastEventId'>)=>`${item.taskId}:${item.kind}:${item.lastEventId}`;
export function applyNewsRead(data:CityNews,confirmed:readonly Pick<CityNewsItem,'taskId'|'kind'|'lastEventId'>[]):CityNews{
  const watermarks=new Map<string,number>();
  for(const item of confirmed){const key=`${item.taskId}:${item.kind}`;watermarks.set(key,Math.max(watermarks.get(key)??0,item.lastEventId));}
  let changed=0;
  const items=data.items.map(item=>{if(item.unread&&item.lastEventId<=(watermarks.get(`${item.taskId}:${item.kind}`)??0)){changed++;return {...item,unread:false};}return item;});
  return {...data,items,unreadCount:Math.max(0,data.unreadCount-changed)};
}
