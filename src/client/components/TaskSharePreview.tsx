import { useRef, useState } from "react";
import { api } from "../api";
import { taskShareExcerpt } from "../../shared/task-share-preview";
import type { TaskDto } from "../../shared/contracts";
export function TaskSharePreview({countryId,task}:{countryId:string;task:TaskDto}) {
  const [open,setOpen]=useState(false),[url,setUrl]=useState(""),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  const requestToken=useRef<string|null>(null);
  const publish=async()=>{
    requestToken.current ??= btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
      .replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
    setBusy(true);setMessage("");
    try { const result=await api<{url:string}>("/api/task-share-previews",{method:"POST",json:{countryId,taskId:task.id,requestToken:requestToken.current,preview:{taskNumber:task.taskNumber,title:taskShareExcerpt(task.title,120),description:taskShareExcerpt(task.description)}}});setUrl(result.url); }
    catch(error){setMessage(error instanceof Error?error.message:"Не удалось создать ссылку");}
    finally{setBusy(false);}
  };
  const revoke=async()=>{
    setBusy(true);setMessage("");
    try {await api(`/api/task-share-previews?countryId=${countryId}&taskId=${task.id}`,{method:"DELETE"});setUrl("");requestToken.current=null;setMessage("Все созданные вами превью этой задачи отозваны.");}
    catch(error){setMessage(error instanceof Error?error.message:"Не удалось отозвать ссылки");}
    finally{setBusy(false);}
  };
  return <section className="task-share-preview">
    <button type="button" aria-expanded={open} onClick={()=>setOpen(!open)}>Поделиться превью</button>
    {open&&<div>
      <p>По этой ссылке будут доступны номер, название и краткое описание. Для открытия самой задачи потребуется доступ к стране.</p>
      <blockquote><strong>#{task.taskNumber} · {taskShareExcerpt(task.title,120)}</strong><p>{taskShareExcerpt(task.description)}</p></blockquote>
      {url?<label>Ссылка с превью<input aria-label="Ссылка с превью" readOnly value={url} onFocus={event=>event.target.select()}/></label>:<button type="button" disabled={busy} onClick={()=>void publish()}>Создать ссылку с превью</button>}
      {url&&<button type="button" onClick={()=>void navigator.clipboard.writeText(url).then(()=>setMessage("Ссылка скопирована"),()=>setMessage("Выделите и скопируйте ссылку из поля."))}>Скопировать превью</button>}
      <button type="button" disabled={busy} onClick={()=>void revoke()}>Отозвать мои превью</button>
      {message&&<p role="status">{message}</p>}
    </div>}
  </section>;
}
