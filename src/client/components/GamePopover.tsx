import { type ReactNode } from 'react';
import { useToolbarDisclosure } from '../use-toolbar-disclosure';

/** Native disclosure keeps its trigger keyboard accessible even before hydration. */
export function GamePopover({label,icon,children,activeLabel,className=''}:{label:string;icon:string;children:ReactNode;activeLabel?:string;className?:string}) {
  const root=useToolbarDisclosure();
  return <details ref={root} className={`game-popover ${className}`}><summary aria-label={label} title={label}><span aria-hidden="true">{icon}</span><span className="game-popover-label">{label}</span>{activeLabel&&<span className="game-filter-active" title={activeLabel} aria-label={`Активный фильтр: ${activeLabel}`}>●</span>}</summary><div className="game-popover-panel" onClick={event=>{if(className.includes("world-menu") && event.target instanceof Element && event.target.closest("button")) {const details=event.currentTarget.closest("details");if(details)details.open=false;}}}>{children}</div></details>;
}
