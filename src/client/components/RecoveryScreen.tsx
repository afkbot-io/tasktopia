import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Button, Field } from "./ui";
import { AuthPanel } from './AuthPanel';
import { AuthLayout } from './AuthLayout';
import { focusAuthFieldError, readAuthFieldErrors, type AuthFieldErrors } from '../auth-form-validation';
export function RecoveryScreen({ onBack }: { onBack: () => void }) {
  const [error, setError] = useState(""); const [done, setDone] = useState(false); const [pending, setPending] = useState(false); const busy = useRef(false);
  const [fieldErrors,setFieldErrors]=useState<AuthFieldErrors>({});
  const errorRef=useRef<HTMLDivElement>(null),doneRef=useRef<HTMLParagraphElement>(null);
  useEffect(()=>{if(error)errorRef.current?.focus();},[error]);
  useEffect(()=>{if(done)doneRef.current?.focus();},[done]);
  return <AuthLayout><AuthPanel title="Вернуться в свой мир">
    {done ? <p ref={doneRef} tabIndex={-1} role="status">Пароль изменён. Войдите с новым паролем. Все прежние сессии, MCP-ключи и резервные коды отозваны.</p> : <form noValidate className="government-access-form" onInput={event=>{
      const input=event.target;if(!(input instanceof HTMLInputElement))return;
      setFieldErrors(current=>{if(!current[input.name])return current;const next={...current};delete next[input.name];return next;});setError('');
    }} onSubmit={event => {
      event.preventDefault(); if (busy.current) return;
      const form=event.currentTarget,errors=readAuthFieldErrors(form);setFieldErrors(errors);
      if(Object.keys(errors).length){setError('');window.requestAnimationFrame(()=>focusAuthFieldError(form,errors));return;}
      const data = Object.fromEntries(new FormData(event.currentTarget));
      busy.current = true; setPending(true); setError("");
      void api("/api/auth/recover", { method: "POST", json: data }).then(() => setDone(true)).catch(reason => setError(reason instanceof Error?reason.message:'Не удалось восстановить доступ')).finally(() => { busy.current = false; setPending(false); });
    }}>
      <p>Введите один из кодов, сохранённых в профиле. Если кодов нет, обратитесь к администратору — восстановление письмом пока недоступно.</p>
      <Field label="Email" name="email" error={fieldErrors.email} type="email" required autoComplete="username" maxLength={254} disabled={pending} />
      <Field label="Резервный код" name="code" error={fieldErrors.code} required autoComplete="off" maxLength={64} disabled={pending} />
      <Field label="Новый пароль" name="password" error={fieldErrors.password} type="password" required minLength={8} maxLength={128} autoComplete="new-password" disabled={pending} />
      <Field label="Повторите новый пароль" name="passwordConfirmation" error={fieldErrors.passwordConfirmation} type="password" required minLength={8} maxLength={128} autoComplete="new-password" disabled={pending} />
      {error && <div ref={errorRef} className="form-error" role="alert" tabIndex={-1}>{error}</div>}
      <Button variant="primary" type="submit" disabled={pending}>{pending ? 'Подождите…' : 'Восстановить доступ'}</Button>
    </form>}
    <Button variant="quiet" onClick={onBack} disabled={pending}>Вернуться ко входу</Button>
  </AuthPanel></AuthLayout>;
}
