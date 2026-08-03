import { useState, type FormEvent } from "react";
import { api } from "../api";

export function AuthScreen({ onAuthenticated, initialError = "" }: {
  onAuthenticated: () => Promise<void>;
  initialError?: string;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [countryLoadFailed, setCountryLoadFailed] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      const body = { email: data.get("email"), password: data.get("password"), ...(mode === "register" ? { name: data.get("name") } : {}) };
      await api(`/api/auth/${mode}`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      try {
        await onAuthenticated();
      } catch (cause) {
        setCountryLoadFailed(true);
        throw cause;
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось войти");
    } finally {
      setPending(false);
    }
  }

  async function retryCountryLoad() {
    setPending(true);
    setError("");
    try {
      await onAuthenticated();
      setCountryLoadFailed(false);
    } catch (cause) {
      setCountryLoadFailed(true);
      setError(cause instanceof Error ? cause.message : "Не удалось загрузить страну");
    } finally {
      setPending(false);
    }
  }

  const visibleError = error || initialError;
  const canRetryCountry = countryLoadFailed || Boolean(initialError);

  return (
    <main className="auth-layout">
      <section className="auth-visual" aria-label="Описание Tasktopia">
        <div className="brand-mark"><span>▦</span> TASKTOPIA</div>
        <div className="auth-copy">
          <p className="eyebrow">ВАША РАБОТА СТАНОВИТСЯ МИРОМ</p>
          <h1>Работа, которая<br />становится миром.</h1>
          <p>Создавайте страны, развивайте города и районы, а каждая задача пройдёт пять видимых стадий строительства.</p>
        </div>
        <div className="auth-tiles" aria-hidden="true">
          {Array.from({ length: 12 }, (_, index) => <i key={index} style={{ "--x": `${(index % 4) * 118}px`, "--y": `${Math.floor(index / 4) * 102}px` } as React.CSSProperties} />)}
        </div>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <p className="eyebrow">ЛОКАЛЬНЫЙ MVP</p>
          <h2>{mode === "login" ? "Вернуться в страну" : "Создать страну"}</h2>
          <p className="muted">Страна будет создана автоматически после регистрации.</p>
          <form onSubmit={submit}>
            {mode === "register" && <label>Имя<input name="name" minLength={2} maxLength={60} required autoComplete="name" /></label>}
            <label>Email<input name="email" type="email" required autoComplete="email" /></label>
            <label>Пароль<input name="password" type="password" minLength={8} required autoComplete={mode === "login" ? "current-password" : "new-password"} /></label>
            {visibleError && <div className="form-error" role="alert">{visibleError}</div>}
            <button className="primary-button" disabled={pending}>{pending ? "Подождите…" : mode === "login" ? "Открыть страну" : "Создать аккаунт"}</button>
          </form>
          {canRetryCountry && <button className="secondary-button auth-retry" disabled={pending} onClick={() => void retryCountryLoad()}>Повторить загрузку</button>}
          <button className="text-button" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); setCountryLoadFailed(false); }}>
            {mode === "login" ? "Нет аккаунта? Зарегистрироваться" : "Уже есть аккаунт? Войти"}
          </button>
        </div>
      </section>
    </main>
  );
}
