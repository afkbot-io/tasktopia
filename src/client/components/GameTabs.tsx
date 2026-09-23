export function GameTabs<T extends string>({id,tabs,value,onChange}:{id:string;tabs:readonly {id:T;label:string;count?:number}[];value:T;onChange:(value:T)=>void}) {
  return <div className="game-tabs" role="tablist" aria-label="Разделы задачи">{tabs.map((tab,index)=><button key={tab.id} id={`${id}-${tab.id}-tab`} role="tab" type="button" aria-selected={value===tab.id} aria-controls={`${id}-${tab.id}-panel`} tabIndex={value===tab.id?0:-1} onClick={()=>onChange(tab.id)} onKeyDown={event=>{
    const next=event.key==='ArrowRight'?(index+1)%tabs.length:event.key==='ArrowLeft'?(index+tabs.length-1)%tabs.length:event.key==='Home'?0:event.key==='End'?tabs.length-1:-1;
    if(next<0)return;event.preventDefault();onChange(tabs[next]!.id);document.getElementById(`${id}-${tabs[next]!.id}-tab`)?.focus();
  }}>{tab.label}{tab.count!==undefined && tab.count>0 && <span>{tab.count}</span>}</button>)}</div>;
}
