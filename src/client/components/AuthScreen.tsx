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
          <p className="eyebrow">УПРАВЛЕНИЕ, КОТОРОЕ ВИДНО</p>
          <h1>Стройте планы.<br />Наблюдайте за страной.</h1>
          <p>Страны объединяют команды, города собирают направления работы, районы показывают спринты, а задачи растут от площадки до готового здания.</p>
          <div className="auth-capabilities" aria-label="Возможности платформы">
            <span><i>01</i> Живая карта</span>
            <span><i>02</i> MCP-интеграция</span>
            <span><i>03</i> Прогресс в реальном времени</span>
          </div>
        </div>
        <div className="auth-atlas" aria-hidden="true">
          <i className="atlas-water" />
          <i className="atlas-road atlas-road-h" />
          <i className="atlas-road atlas-road-v" />
          {Array.from({ length: 9 }, (_, index) => <i key={index} className={`atlas-building atlas-building-${index + 1}`} />)}
          <i className="atlas-park" />
          <i className="atlas-pulse" />
        </div>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <p className="eyebrow">ЗАЩИЩЁННЫЙ ДОСТУП</p>
          <h2>{mode === "login" ? "Войти в Tasktopia" : "Основать страну"}</h2>
          <p className="muted">{mode === "login" ? "Продолжите работу с вашими странами и городами." : "Первая страна будет создана автоматически вместе с аккаунтом."}</p>
          <form onSubmit={submit}>
            {mode === "register" && <label>Имя<input name="name" minLength={2} maxLength={60} required autoComplete="name" /></label>}
            <label>Email<input name="email" type="email" required autoComplete="email" /></label>
            <label>Пароль<input name="password" type="password" minLength={8} required autoComplete={mode === "login" ? "current-password" : "new-password"} /></label>
            {visibleError && <div className="form-error"><strong>Не удалось продолжить</strong><span role="alert">{visibleError}</span></div>}
            <button className="primary-button" disabled={pending}>{pending ? "Подождите…" : mode === "login" ? "Открыть страну" : "Создать аккаунт"}</button>
          </form>
          {canRetryCountry && <button className="secondary-button auth-retry" disabled={pending} onClick={() => void retryCountryLoad()}>Повторить загрузку</button>}
          <button className="text-button" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); setCountryLoadFailed(false); }}>
            {mode === "login" ? "Нет аккаунта? Зарегистрироваться" : "Уже есть аккаунт? Войти"}
          </button>
          <p className="auth-security">Сессия хранится в защищённой HTTP-only cookie. Пароль не передаётся интеграциям.</p>
        </div>
      </section>
    </main>
  );
}
