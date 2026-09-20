import { useRef, useState } from "react";
import { api } from "../api";
import { taskSharePublicText, taskShareLocationText, type TaskShareDraft } from "../../shared/task-share-preview";
import type { TaskDto } from "../../shared/contracts";

export function TaskSharePreview({countryId,task}:{countryId:string;task:TaskDto}) {
  const [open,setOpen]=useState(false),[url,setUrl]=useState(""),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  const [draft,setDraft]=useState<TaskShareDraft|null>(null);
  const [description,setDescription]=useState(""),[includeDescription,setIncludeDescription]=useState(true);
  const [included,setIncluded]=useState({country:true,city:true,district:false});
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
    catch(error){setMessage(error instanceof Error?error.message:"Не удалось создать ссылку");}
    finally{setBusy(false);}
  };
  const revoke=async()=>{
    setBusy(true);setMessage("");
    try {await api(`/api/task-share-previews?countryId=${countryId}&taskId=${task.id}`,{method:"DELETE"});setUrl("");attempt.current=null;setMessage("Все созданные вами превью этой задачи отозваны.");}
    catch(error){setMessage(error instanceof Error?error.message:"Не удалось отозвать ссылки");}
    finally{setBusy(false);}
  };
  return <section className="task-share-preview">
    <button type="button" aria-expanded={open} onClick={()=>{setOpen(!open);if(!open&&!draft&&!busy)void load();}}>Поделиться превью</button>
    {open&&<div>
      <p>Любой со ссылкой увидит выбранные поля. Сама задача, комментарии, вложения и участники останутся закрытыми.</p>
      {draft&&preview&&<>
        <fieldset disabled={busy||Boolean(url)}>
          <legend>Что показать публично</legend>
          <label><input type="checkbox" checked={includeDescription} onChange={event=>setIncludeDescription(event.target.checked)}/>Краткое описание</label>
          {includeDescription&&<label>Публичное описание<textarea aria-label="Публичное описание" value={description} maxLength={400} rows={3} onChange={event=>setDescription(event.target.value)}/></label>}
          {(['country','city','district'] as const).map(key=>draft.location[key]&&<label key={key}><input type="checkbox" checked={included[key]} onChange={event=>setIncluded({...included,[key]:event.target.checked})}/>{{country:'Страна',city:'Город',district:'Район'}[key]}: {draft.location[key]}</label>)}
        </fieldset>
        <p>Проверьте текст ниже перед публикацией. Ссылки, email и типичные секреты скрываются автоматически, но личные данные нужно убрать самостоятельно.</p>
        <blockquote><strong>#{preview.taskNumber} · {preview.title}</strong>{preview.description&&<p>{preview.description}</p>}<p>{taskShareLocationText(preview.location)}</p></blockquote>
        {url?<><img className="task-share-card-image" src={`${url}/image.png`} width="1200" height="630" alt="Опубликованная OG-карточка"/><label>Ссылка с превью<input aria-label="Ссылка с превью" readOnly value={url} onFocus={event=>event.target.select()}/></label></>:<button type="button" disabled={busy} onClick={()=>void publish()}>Создать ссылку с превью</button>}
      </>}
      {!url&&<button type="button" disabled={busy} onClick={()=>void load()}>{busy?'Загрузка…':'Обновить данные превью'}</button>}
      {url&&<button type="button" onClick={()=>void navigator.clipboard.writeText(url).then(()=>setMessage("Ссылка скопирована"),()=>setMessage("Выделите и скопируйте ссылку из поля."))}>Скопировать превью</button>}
      <button type="button" disabled={busy} onClick={()=>void revoke()}>Отозвать мои превью</button>
      <p>Превью — снимок: изменения задачи не публикуются автоматически. После отзыва мессенджер может сохранять ранее загруженную карточку.</p>
      {message&&<p role="status">{message}</p>}
    </div>}
  </section>;
}
