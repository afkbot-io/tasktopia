import { useEffect, useId, useRef, useState } from "react";
import { api, ApiError } from "../api";
import { taskSharePublicText, type TaskShareDraft } from "../../shared/task-share-preview";
import type { TaskDto } from "../../shared/contracts";

export function TaskSharePreview({countryId,task}:{countryId:string;task:TaskDto}) {
  const [open,setOpen]=useState(false),[url,setUrl]=useState(""),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  const [draft,setDraft]=useState<TaskShareDraft|null>(null);
  const [description,setDescription]=useState(""),[includeDescription,setIncludeDescription]=useState(false);
  const [included,setIncluded]=useState({country:true,city:true,district:false});
  const panelId=useId();
  const root=useRef<HTMLElement>(null),toggle=useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    if(!open)return;
    const outside=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false);};
    const escape=(event:KeyboardEvent)=>{if(event.key==="Escape"){event.stopPropagation();setOpen(false);toggle.current?.focus();}};
    document.addEventListener("pointerdown",outside);
    document.addEventListener("keydown",escape,true);
    return ()=>{document.removeEventListener("pointerdown",outside);document.removeEventListener("keydown",escape,true);};
  },[open]);
  const attempt=useRef<{token:string;payload:string}|null>(null);
  const load=async()=>{
    setBusy(true);setMessage("");
    try {
      const value=await api<TaskShareDraft>(`/api/task-share-previews?countryId=${countryId}&taskId=${task.id}`);
      setDraft(value);setDescription(value.description);attempt.current=null;
    } catch(error){setMessage(error instanceof Error?error.message:"Не удалось загрузить превью");}
    finally{setBusy(false);}
  };
  const preview=draft?{...draft,description:includeDescription?taskSharePublicText(description):"",location:{country:included.country?draft.location.country:null,city:included.city?draft.location.city:null,district:included.district?draft.location.district:null}}:null;
  const publish=async()=>{
    if(!preview)return;
    const payload=JSON.stringify(preview);
    if(attempt.current?.payload!==payload)attempt.current={payload,token:btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"")};
    setBusy(true);setMessage("");
    try {const result=await api<{url:string}>("/api/task-share-previews",{method:"POST",json:{countryId,taskId:task.id,requestToken:attempt.current.token,preview}});setUrl(result.url);}
    catch(error){if(error instanceof ApiError&&error.status===409){setDraft(null);attempt.current=null;}setMessage(error instanceof Error?error.message:"Не удалось создать ссылку");}
    finally{setBusy(false);}
  };
  const copy=async()=>{
    try {await navigator.clipboard.writeText(url);setMessage("Ссылка скопирована");}
    catch {setMessage("Выделите и скопируйте ссылку из поля.");}
  };
  const revoke=async()=>{
    setBusy(true);setMessage("");
    try {await api(`/api/task-share-previews?countryId=${countryId}&taskId=${task.id}`,{method:"DELETE"});setUrl("");attempt.current=null;setMessage("Все созданные вами превью этой задачи отозваны.");}
    catch(error){setMessage(error instanceof Error?error.message:"Не удалось отозвать ссылки");}
    finally{setBusy(false);}
  };
  return <section className="task-share-preview" ref={root}>
    <button ref={toggle} className="task-action" type="button" aria-expanded={open} aria-controls={panelId} onClick={()=>{setOpen(!open);if(!open&&!draft&&!busy)void load();}}>Превью <span aria-hidden="true">▾</span></button>
    {open&&<div className="task-preview-popover" id={panelId} role="region" aria-label="Публичное превью">
      <p className="task-preview-hint">Публичная ссылка: название, страна и город. Описание — по желанию.</p>
      {draft&&preview&&<>
        <div className="task-preview-actions">
          {url?<button className="task-action" type="button" onClick={()=>void copy()}>Скопировать</button>:<button className="task-action" type="button" disabled={busy} onClick={()=>void publish()}>{busy?'Создаём…':'Создать ссылку на превью'}</button>}
          <button className="task-action" type="button" disabled={busy} title="Отозвать все созданные вами превью этой задачи" onClick={()=>void revoke()}>Отозвать</button>
        </div>
        {url?<label className="task-preview-link">Ссылка на превью<input aria-label="Ссылка с превью" readOnly value={url} onFocus={event=>event.target.select()}/></label>:<details className="task-preview-settings">
          <summary>Настроить поля</summary>
          <fieldset disabled={busy}>
            <legend>Что показать публично</legend>
            <label><input type="checkbox" checked={includeDescription} onChange={event=>setIncludeDescription(event.target.checked)}/>Краткое описание</label>
            {includeDescription&&<label>Публичное описание<textarea aria-label="Публичное описание" value={description} maxLength={400} rows={3} onChange={event=>setDescription(event.target.value)}/></label>}
            {(['country','city','district'] as const).map(key=>draft.location[key]&&<label key={key}><input type="checkbox" checked={included[key]} onChange={event=>setIncluded({...included,[key]:event.target.checked})}/>{{country:'Страна',city:'Город',district:'Район'}[key]}: {draft.location[key]}</label>)}
          </fieldset>
          {includeDescription&&<p>Проверьте описание перед публикацией и удалите личные данные.</p>}
        </details>}
        <p className="task-preview-hint">Задача и её материалы закрыты. Отзыв отключит все ваши ссылки на её превью; карточка может остаться в кеше мессенджера.</p>
      </>}
      {!draft&&<button className="task-action" type="button" disabled={busy} onClick={()=>void load()}>{busy?'Загрузка…':'Повторить загрузку'}</button>}
      {message&&<p role="status">{message}</p>}
    </div>}
  </section>;
}
