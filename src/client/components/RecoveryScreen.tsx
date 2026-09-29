import { useRef, useState } from "react";
import { api } from "../api";
import { Button, Field } from "./ui";
export function RecoveryScreen({ onBack }: { onBack: () => void }) {
  const [error, setError] = useState(""); const [done, setDone] = useState(false); const [pending, setPending] = useState(false); const busy = useRef(false);
  return <main className="auth-screen"><section className="account-entry settings-panel settings-body"><h1>Вернуться в свой мир</h1>
    {done ? <p role="status">Пароль изменён. Войдите с новым паролем. Все прежние сессии, MCP-ключи и резервные коды отозваны.</p> : <form className="government-access-form" onSubmit={event => {
      event.preventDefault(); if (busy.current) return;
      const data = Object.fromEntries(new FormData(event.currentTarget));
      if (data.password !== data.passwordConfirmation) { setError("Пароли не совпадают"); return; }
      busy.current = true; setPending(true); setError("");
      void api("/api/auth/recover", { method: "POST", json: data }).then(() => setDone(true)).catch(reason => setError(reason.message)).finally(() => { busy.current = false; setPending(false); });
    }}>
      <p>Введите один из кодов, сохранённых в профиле. Если кодов нет, обратитесь к администратору — восстановление письмом пока недоступно.</p>
      <Field label="Email" name="email" type="email" required autoComplete="username" maxLength={254} disabled={pending} />
      <Field label="Резервный код" name="code" required autoComplete="off" maxLength={64} disabled={pending} />
      <Field label="Новый пароль" name="password" type="password" required minLength={8} maxLength={128} autoComplete="new-password" disabled={pending} />
      <Field label="Повторите новый пароль" name="passwordConfirmation" type="password" required minLength={8} maxLength={128} autoComplete="new-password" disabled={pending} />
      {error && <p role="alert">{error}</p>}
      <Button type="submit" disabled={pending}>Восстановить доступ</Button>
    </form>}
    <Button onClick={onBack} disabled={pending}>Вернуться ко входу</Button>
  </section></main>;
}
