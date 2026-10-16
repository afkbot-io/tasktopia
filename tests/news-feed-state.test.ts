import { describe, expect, it } from 'vitest';
import { applyNewsRead, newsItemKey } from '../src/client/news-feed-state';
import type { CityNews, CityNewsItem } from '../src/shared/city-news';
const item=(id:number,kind:CityNewsItem['kind']='COMMENT'):CityNewsItem=>({taskId:'task',taskNumber:42,title:'Задача',cityName:'Город',kind,count:1,lastEventId:id,at:'2026-10-16T10:00:00Z',unread:true});
describe('confirmed explicit news read',()=>{
  it('applies the confirmed watermark to older same-kind series without hiding a later update',()=>{
    const data:CityNews={items:[item(88),item(77),item(66),item(55,'MATERIAL')],unreadCount:4,nextBefore:null};
    const next=applyNewsRead(data,[item(77)]);
    expect(next.items.map(row=>row.unread)).toEqual([true,false,false,true]);expect(next.unreadCount).toBe(2);
    expect(data.items.every(row=>row.unread)).toBe(true);
    expect(newsItemKey(item(77))).not.toBe(newsItemKey(item(66)));
  });
});
