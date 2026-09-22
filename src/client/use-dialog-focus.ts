import { useEffect, type RefObject } from 'react';

export function useDialogFocus(ref: RefObject<HTMLElement | null>) {
  useEffect(()=>{
    const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const dialog=ref.current;
    if(!dialog)return;
    const targets=()=>[...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')].filter(node=>node.getClientRects().length>0);
    targets()[0]?.focus();
    const trap=(event:KeyboardEvent)=>{
      if(event.key!=='Tab')return;
      const nodes=targets(),first=nodes[0],last=nodes.at(-1);
      if(!first){event.preventDefault();return;}
      if(event.shiftKey && (document.activeElement===first || !dialog.contains(document.activeElement))){event.preventDefault();last?.focus();}
      else if(!event.shiftKey && (document.activeElement===last || !dialog.contains(document.activeElement))){event.preventDefault();first.focus();}
    };
    dialog.addEventListener('keydown',trap);
    return()=>{dialog.removeEventListener('keydown',trap);if(previous?.isConnected)previous.focus();};
  },[ref]);
}
