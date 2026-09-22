import { useEffect, useRef, type ReactNode } from 'react';

/** Native disclosure keeps its trigger keyboard accessible even before hydration. */
export function GamePopover({label,icon,children,activeLabel,className=''}:{label:string;icon:string;children:ReactNode;activeLabel?:string;className?:string}) {
  const root=useRef<HTMLDetailsElement>(null);
  useEffect(()=>{
    const outside=(event:PointerEvent)=>{if(root.current?.open && event.target instanceof Node && !root.current.contains(event.target)) root.current.open=false;};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape' && root.current?.open){root.current.open=false;root.current.querySelector('summary')?.focus();}};
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};
  },[]);
  return <details ref={root} className={`game-popover ${className}`}><summary aria-label={label} title={label}><span aria-hidden="true">{icon}</span><span className="game-popover-label">{label}</span>{activeLabel&&<span className="game-filter-active" title={activeLabel} aria-label={`Активный фильтр: ${activeLabel}`}>●</span>}</summary><div className="game-popover-panel" onClick={event=>{if(className.includes("world-menu") && event.target instanceof Element && event.target.closest("button") && root.current)root.current.open=false;}}>{children}</div></details>;
}
