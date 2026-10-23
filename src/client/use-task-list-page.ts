import { useEffect, useState } from 'react';
import type { TaskListPageDto } from '../shared/task-read-contracts';
import { readTaskListPage, taskListPagePath, type TaskCatalogFilters } from './task-list-reader';

type Navigation = {scope:string;cursors:(string|null)[];index:number};
type ReadState = {scope:string;cursor:string|null;page?:TaskListPageDto;error?:string;pending:boolean};
const start=(scope:string):Navigation=>({scope,cursors:[null],index:0});

/** One page in memory/DOM. Every country/filter/revision starts a new cursor chain. */
export function useTaskListPage({countryId,filters,revision=0,enabled=true,debounceMs=0}:{
  countryId:string;filters:TaskCatalogFilters;revision?:number;enabled?:boolean;debounceMs?:number;
}) {
  const path=taskListPagePath(countryId,filters),scope=JSON.stringify([path,revision]);
  const [navigation,setNavigation]=useState<Navigation>(()=>start(scope));
  const [read,setRead]=useState<ReadState>();
  const [retry,setRetry]=useState(0);
  useEffect(()=>{setNavigation(previous=>previous.scope===scope?previous:start(scope));},[scope]);
  const current=navigation.scope===scope?navigation:start(scope),cursor=current.cursors[current.index]??null;
  const result=enabled&&read?.scope===scope&&read.cursor===cursor?read:undefined;
  useEffect(()=>{
    if(!enabled)return;
    const controller=new AbortController();let active=true;
    setRead({scope,cursor,pending:true});
    const timer=setTimeout(()=>{
      void readTaskListPage(countryId,filters,cursor,controller.signal).then(page=>{
        if(active)setRead({scope,cursor,page,pending:false});
      }).catch(cause=>{
        if(active)setRead({scope,cursor,pending:false,error:cause instanceof Error?cause.message:'Не удалось загрузить список задач'});
      });
    },debounceMs);
    return()=>{active=false;clearTimeout(timer);controller.abort();};
    // `path` is the normalized serialized filter contract, independent of object identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[scope,cursor,retry,enabled,debounceMs]);
  const pending=enabled&&(!result||result.pending),page=result?.page;
  return {
    items:page?.items??[],pending,error:result?.error,pageNumber:current.index+1,
    hasPrevious:current.index>0,hasNext:Boolean(page?.nextCursor),
    previous:()=>setNavigation(previous=>{
      const value=previous.scope===scope?previous:start(scope);
      return value.index===current.index&&value.index>0?{...value,index:value.index-1}:previous;
    }),
    next:()=>{if(!page?.nextCursor||pending)return;const next=page.nextCursor;
      setNavigation(previous=>{
        const value=previous.scope===scope?previous:start(scope);
        return value.index===current.index?{scope,cursors:[...value.cursors.slice(0,value.index+1),next],index:value.index+1}:previous;
      });
    },
    retry:()=>setRetry(value=>value+1),
  };
}
