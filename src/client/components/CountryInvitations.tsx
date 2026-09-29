import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Button, Field } from "./ui";
type Invitation = { id: string; email: string; role: string; expiresAt: string };
export function CountryInvitations({ countryId }: { countryId: string }) {
  const [items, setItems] = useState<Invitation[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("MEMBER");
  const [link, setLink] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const revision = useRef(0);
  const endpoint = `/api/countries/${countryId}/invitations`;
  useEffect(() => { const c = new AbortController(); const version = revision.current; void api<Invitation[]>(endpoint, { signal: c.signal }).then(items => { if (!c.signal.aborted && version === revision.current) setItems(items); }).catch(() => { if (!c.signal.aborted) setError("Не удалось загрузить приглашения. Откройте паспорт ещё раз."); }); return () => c.abort(); }, [endpoint]);
  return <details className="government-access"><summary>Приглашения по ссылке</summary>
    <p>Для нового участника создайте ссылку и передайте лично. Она действует 7 дней и подходит только указанному email. Получателю нужно зарегистрироваться или войти.</p>
    <form className="government-access-form" onSubmit={event => {
      event.preventDefault(); if (busy.current) return; busy.current = true; revision.current++; setPending(true); setError(""); setLink("");
      void api<Invitation & { token: string }>(endpoint, { method: "POST", json: { email, role } }).then(invite => { setItems(current => [...current.filter(item => item.email !== invite.email), invite]); setLink(`${location.origin}/#invite=${invite.token}`); }).catch(reason => setError(reason.message)).finally(() => { busy.current = false; setPending(false); });
    }}>
      <Field label="Email приглашённого" type="email" required maxLength={254} value={email} disabled={pending} onChange={event => setEmail(event.target.value)} />
      <label>Роль приглашённого<select value={role} disabled={pending} onChange={event => setRole(event.target.value)}><option value="MEMBER">Министр</option><option value="VIEWER">Наблюдатель</option></select></label>
      <Button type="submit" disabled={pending}>Создать ссылку</Button>
    </form>
    {error && <p role="alert">{error}</p>}
    {link && <div className="government-access-form"><Field label="Ссылка приглашения" readOnly value={link} /><Button onClick={() => { void navigator.clipboard.writeText(link).catch(() => setError("Выделите и скопируйте ссылку вручную")); }}>Копировать приглашение</Button><p>Ссылка показывается один раз. Новая ссылка для того же email отменяет предыдущую.</p></div>}
    {items.map(item => <div key={item.id} className="government-access-actions"><span>{item.email} · до {new Date(item.expiresAt).toLocaleDateString("ru-RU")}</span><Button disabled={pending} onClick={() => { if (busy.current) return; busy.current = true; revision.current++; setPending(true); setError(""); void api(`${endpoint}/${item.id}`, { method: "DELETE" }).then(() => { setItems(current => current.filter(i => i.id !== item.id)); setLink(""); }).catch(reason => setError(reason.message)).finally(() => { busy.current = false; setPending(false); }); }}>Отозвать приглашение</Button></div>)}
  </details>;
}
