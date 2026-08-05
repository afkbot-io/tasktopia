import { useState, type FormEvent } from "react";
import { api } from "../api";
import { Button, Field } from "./ui";

const domainLevels = [
  ["Страна", "ваш мир", "01"],
  ["Город", "центр развития", "02"],
  ["Район", "этап строительства", "03"],
  ["Здание", "задача", "04"],
] as const;

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
      const body = mode === "register"
        ? {
            email: data.get("email"), password: data.get("password"), name: data.get("name"),
            countryName: data.get("countryName"), cityName: data.get("cityName"),
          }
        : { email: data.get("email"), password: data.get("password") };
      await api(`/api/auth/${mode}`, { method: "POST", json: body });
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

  return <main className="grid h-full overflow-y-auto bg-[#091518] lg:grid-cols-[minmax(0,1.15fr)_minmax(420px,.85fr)] lg:overflow-hidden">
    <section className="auth-visual relative min-h-[340px] overflow-hidden px-6 py-7 sm:px-10 lg:min-h-0 lg:px-14 lg:py-10" aria-label="Описание Tasktopia">
      <div className="brand-mark relative z-[2]"><span>▦</span> TASKTOPIA</div>
      <div className="relative z-[2] mt-16 max-w-3xl lg:mt-[14vh]">
        <p className="eyebrow">УПРАВЛЕНИЕ, КОТОРОЕ ВИДНО</p>
        <h1 className="m-0 max-w-3xl text-balance text-[clamp(42px,5.5vw,78px)] font-black leading-[.96] tracking-[-.055em] text-[#f4efdf]">Стройте планы.<br />Наблюдайте за страной.</h1>
        <p className="mt-6 max-w-xl text-[15px] leading-7 text-[#aec0bc] sm:text-[17px]">Tasktopia превращает ваши дела в живую страну. Развитие городов становится понятным без ещё одной таблицы.</p>
      </div>
      <div className="auth-atlas" aria-hidden="true">
        <i className="atlas-water" /><i className="atlas-road atlas-road-h" /><i className="atlas-road atlas-road-v" />
        {Array.from({ length: 9 }, (_, index) => <i key={index} className={`atlas-building atlas-building-${index + 1}`} />)}
        <i className="atlas-park" /><i className="atlas-pulse" />
      </div>
    </section>

    <section className="grid place-items-center border-t border-[#2b4046] bg-[#0d1a1e] p-4 sm:p-8 lg:overflow-y-auto lg:border-l lg:border-t-0 lg:p-10">
      <div className="w-full max-w-[500px] rounded-[24px] border border-[#304a52] bg-[linear-gradient(155deg,#14282e,#0c181c)] p-5 shadow-[0_28px_80px_#0007] sm:p-8">
        <p className="eyebrow">{mode === "login" ? "С ВОЗВРАЩЕНИЕМ" : "НОВОЕ ПРОСТРАНСТВО"}</p>
        <h2 className="m-0 text-3xl font-black tracking-[-.04em] text-[#f1f2e8] sm:text-4xl">{mode === "login" ? "Войти в Tasktopia" : "Основать страну"}</h2>
        <p className="mt-3 text-sm leading-6 text-[#91a7aa]">{mode === "login" ? "Вернитесь к управлению страной и её городами." : "Создадим страну и первый город — карта будет готова сразу после регистрации."}</p>

        <dl className="mt-5 grid grid-cols-2 gap-2" aria-label="Как устроена Tasktopia">
          {domainLevels.map(([world, work, number]) => <div key={world} className="grid grid-cols-[24px_1fr] gap-x-2 rounded-xl border border-[#2a444c] bg-[#0a171a] px-3 py-2.5">
            <dt className="row-span-2 font-mono text-[10px] font-bold text-[#d8b84d]">{number}</dt>
            <dd className="m-0 text-xs font-black text-[#e6ece6]">{world}</dd>
            <dd className="m-0 text-[11px] text-[#82999d]">{work}</dd>
          </div>)}
        </dl>

        <form onSubmit={submit} className="mt-6 grid gap-3.5">
          {mode === "register" && <>
            <Field label="Имя" name="name" minLength={2} maxLength={60} required autoComplete="name" />
            <div className="grid gap-3.5 sm:grid-cols-2">
              <Field label="Название вашей первой страны" name="countryName" minLength={2} maxLength={100} required placeholder="Например, Атутаелия" hint="Её имя появится на карте" />
              <Field label="Название первого города" name="cityName" minLength={2} maxLength={100} required placeholder="Например, Столица" hint="Первый город создаётся сразу" />
            </div>
          </>}
          <Field label="Email" name="email" type="email" required autoComplete="email" />
          <Field label="Пароль" name="password" type="password" minLength={8} maxLength={128} required autoComplete={mode === "login" ? "current-password" : "new-password"} />
          {visibleError && <div className="grid gap-1 rounded-xl border border-[#9b4d4d] bg-[#4a2025] px-3 py-2.5 text-sm text-[#ffd7d7]"><strong className="text-[10px] tracking-wider">НЕ УДАЛОСЬ ПРОДОЛЖИТЬ</strong><span role="alert">{visibleError}</span></div>}
          <Button variant="primary" type="submit" className="mt-1 w-full" disabled={pending}>{pending ? "Подождите…" : mode === "login" ? "Открыть страну" : "Создать аккаунт"}</Button>
        </form>
        {canRetryCountry && <Button className="mt-2 w-full" disabled={pending} onClick={() => void retryCountryLoad()}>Повторить загрузку</Button>}
        <Button variant="quiet" className="mt-2 w-full" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); setCountryLoadFailed(false); }}>
          {mode === "login" ? "Нет аккаунта? Зарегистрироваться" : "Уже есть аккаунт? Войти"}
        </Button>
        <p className="mb-0 mt-4 border-t border-[#293d43] pt-4 text-[10px] leading-4 text-[#748b8f]">Сессия хранится в защищённой HTTP-only cookie. Пароль не передаётся интеграциям.</p>
      </div>
    </section>
  </main>;
}
