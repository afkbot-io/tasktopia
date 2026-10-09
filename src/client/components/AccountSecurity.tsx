import { useRef, useState, type FormEvent } from "react";
import { api } from "../api";
import { Button, Field } from "./ui";

export function AccountSecurity({ onLogout }: { onLogout: () => Promise<void> }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [codes, setCodes] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy.current) return;
    if (password !== confirmation) { setError("Пароли не совпадают"); return; }
    busy.current = true; setPending(true); setError("");
    try {
      await api("/api/account/password", { method: "POST", json: { currentPassword, password, passwordConfirmation: confirmation } });
      await onLogout();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось изменить пароль"); }
    finally { busy.current = false; setPending(false); }
  }
  return <section className="settings-section account-security">
    <div className="settings-section-heading"><div><h3>Защита аккаунта</h3>
    <p>После смены пароля нужно войти заново на всех устройствах. MCP-ключи будут отозваны.</p></div></div>
    <form className="government-access-form" onSubmit={submit}>
      <Field label="Текущий пароль" type="password" autoComplete="current-password" required maxLength={128} value={currentPassword} disabled={pending} onChange={e => setCurrentPassword(e.target.value)} />
      <Field label="Новый пароль" type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={password} disabled={pending} onChange={e => setPassword(e.target.value)} />
      <Field label="Повторите новый пароль" type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={confirmation} disabled={pending} onChange={e => setConfirmation(e.target.value)} />
      {error && <p className="form-error" role="alert">{error}</p>}
      <Button type="submit" disabled={pending}>{pending ? "Сохраняем…" : "Сменить пароль"}</Button>
    </form>
    <details className="government-access"><summary>Резервные коды восстановления</summary>
      <p>Сохраните коды вне Tasktopia. Они показываются один раз. Новый набор заменяет предыдущий; смена или восстановление пароля отзывает весь набор.</p>
      <Button disabled={pending || !currentPassword} onClick={() => {
        if (busy.current) return; busy.current = true; setPending(true); setError(""); setCodes([]);
        void api<{ codes: string[] }>("/api/account/recovery-codes", { method: "POST", json: { password: currentPassword } }).then(result => setCodes(result.codes)).catch(reason => setError(reason.message)).finally(() => { busy.current = false; setPending(false); });
      }}>Получить новый набор кодов</Button>
      <p>Для получения кодов заполните поле «Текущий пароль» выше.</p>
      {codes.length > 0 && <div><pre aria-label="Резервные коды">{codes.join("\n")}</pre><Button onClick={() => { void navigator.clipboard.writeText(codes.join("\n")).catch(() => setError("Скопируйте коды вручную")); }}>Копировать коды</Button><Button onClick={() => setCodes([])}>Коды сохранены</Button></div>}
    </details>
  </section>;
}
