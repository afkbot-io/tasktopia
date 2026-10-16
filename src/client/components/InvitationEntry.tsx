import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Button } from "./ui";
import { AuthPanel } from './AuthPanel';
import { AuthLayout } from './AuthLayout';
export function InvitationEntry({ token, email, onDone }: { token: string; email: string; onDone: () => Promise<void> }) {
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const [accepted,setAccepted]=useState(false);
  const submitting=useRef(false), acceptedRef=useRef(false),errorRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(error)errorRef.current?.focus();},[error]);
  async function proceed(accept:boolean){
    if(submitting.current)return;submitting.current=true;setBusy(true);setError('');
    try {
      if(accept&&!acceptedRef.current){await api('/api/invitations/accept',{method:'POST',json:{token}});acceptedRef.current=true;setAccepted(true);}
      await onDone();
    } catch(reason){setError(reason instanceof Error?reason.message:'Не удалось открыть страну');}
    finally {submitting.current=false;setBusy(false);}
  }
  return <AuthLayout><AuthPanel title="Приглашение в страну"><p>Вы вошли как {email}. {accepted?'Приглашение принято. Откройте страну.':'Примите приглашение, чтобы открыть страну.'}</p>{error && <div ref={errorRef} className="form-error" role="alert" tabIndex={-1}>{error}</div>}
    <Button variant="primary" disabled={busy} onClick={() => void proceed(true)}>{busy ? 'Подождите…' : accepted?'Открыть страну':'Принять приглашение'}</Button>
    <Button variant="quiet" disabled={busy} onClick={() => void proceed(false)}>Вернуться в свой мир</Button>
  </AuthPanel></AuthLayout>;
}
