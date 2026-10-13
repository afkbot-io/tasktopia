import { RecoveryScreen } from "./RecoveryScreen";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { gameAssetUrl, getBuilding, PROP_CATALOG, TERRAIN_SPRITES } from "../../shared/catalog";
import { microAmbientSprite } from "../../shared/micro-ambient";
import { api } from "../api";
import { Button, Field, GameIcon } from "./ui";
import { AuthPanel } from './AuthPanel';
import { AuthRoad } from './AuthRoad';

// The decorative city uses the same reviewed family and stage URLs as the map.
const authBuilding = getBuilding("compact-apartment-v1");
const authBuildingStages = [5, 3, 4, 5] as const;

export function AuthScreen({ onAuthenticated, initialError = "" }: {
  onAuthenticated: () => Promise<void>;
  initialError?: string;
}) {
  const [recovering, setRecovering] = useState(false);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [error, setError] = useState("");
  const submitting = useRef(false);
  const [pending, setPending] = useState(false);
  const [countryLoadFailed, setCountryLoadFailed] = useState(false);
  const [registrationEnabled, setRegistrationEnabled] = useState(false);

  useEffect(() => {
    let active = true;
    void api<{ registrationEnabled: boolean }>("/api/auth/config")
      .then((result) => {
        if (active) setRegistrationEnabled(result.registrationEnabled);
      })
      .catch(() => {
        if (active) setRegistrationEnabled(false);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!registrationEnabled && mode === "register") setMode("login");
  }, [mode, registrationEnabled]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const data = new FormData(event.currentTarget);
    if (mode === "register" && data.get("password") !== data.get("passwordConfirmation")) {
      setError("Пароли не совпадают");
      return;
    }
    submitting.current = true;
    setPending(true);
    setError("");
    try {
      const body = mode === "register"
        ? {
            email: data.get("email"), password: data.get("password"), passwordConfirmation: data.get("passwordConfirmation"), name: data.get("name"),
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
      submitting.current = false;
      setPending(false);
    }
  }

  async function retryCountryLoad() {
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setError("");
    try {
      await onAuthenticated();
      setCountryLoadFailed(false);
    } catch (cause) {
      setCountryLoadFailed(true);
      setError(cause instanceof Error ? cause.message : "Не удалось загрузить страну");
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  const visibleError = error || initialError;
  const canRetryCountry = countryLoadFailed || Boolean(initialError);

  if (recovering) return <RecoveryScreen onBack={() => setRecovering(false)} />;
  return <main className="auth-screen flex h-full flex-col overflow-y-auto lg:grid lg:grid-cols-[minmax(0,1.15fr)_minmax(420px,.85fr)] lg:overflow-hidden">
    <section className="auth-visual relative min-h-[500px] overflow-hidden px-6 py-7 sm:px-10 lg:min-h-0 lg:px-14 lg:py-10" aria-label="Описание Tasktopia">
      <div className="brand-mark relative z-[2]"><GameIcon name="world" /> TASKTOPIA</div>
      <div className="auth-intro relative z-[2]">
        <h1>Дела становятся городом.</h1>
        <p>Задачи — здания, районы — спринты, города — ваши проекты.</p>
      </div>
      <div className="auth-world" aria-hidden="true" style={{ backgroundImage: `url(${gameAssetUrl(TERRAIN_SPRITES.GRASS![0]!)})` }}>
        <i className="auth-world-water" style={{ backgroundImage: `url(${gameAssetUrl(TERRAIN_SPRITES.SHALLOW_WATER![0]!)})` }} />
        <AuthRoad /><AuthRoad vertical />
        {authBuildingStages.map((stage, index) => <img key={index} data-auth-scene-sprite
          className={`auth-world-sprite auth-world-building auth-world-building-${index + 1}`}
          src={authBuilding.stages[stage - 1]} width={authBuilding.spriteSize.width * 2} height={authBuilding.spriteSize.height * 2} alt="" />)}
        <img data-auth-scene-sprite className="auth-world-sprite auth-world-tree-oak" src={PROP_CATALOG["tree-oak"]!.path} alt="" />
        <img data-auth-scene-sprite className="auth-world-sprite auth-world-tree-pine" src={PROP_CATALOG["tree-pine"]!.path} alt="" />
        <img data-auth-scene-sprite className="auth-world-sprite auth-world-car" src={microAmbientSprite("car", "van", "east").url} width={16} height={16} alt="" />
        <img data-auth-scene-sprite className="auth-world-sprite auth-world-statue" src={PROP_CATALOG["statue-hero"]!.path} alt="" />
        <i className="auth-world-pulse" />
      </div>
    </section>

    <section className="auth-form-section">
      <AuthPanel headingLevel={2} title={mode === 'login' ? 'Войти в Tasktopia' : 'Основать страну'}>
        {mode === 'register' && <p>Создадим страну и первый город. Карта откроется после регистрации.</p>}

        <form onSubmit={submit} className="mt-6 grid gap-3.5">
          {mode === "register" && <>
            <Field label="Имя" name="name" minLength={2} maxLength={60} required autoComplete="name" disabled={pending} />
            <div className="grid gap-3.5 sm:grid-cols-2">
              <Field label="Название вашей первой страны" name="countryName" minLength={2} maxLength={100} required placeholder="Например, Атутаелия" hint="Её имя появится на карте" disabled={pending} />
              <Field label="Название первого города" name="cityName" minLength={2} maxLength={100} required placeholder="Например, Столица" hint="Первый город создаётся сразу" disabled={pending} />
            </div>
          </>}
          <Field label="Email" name="email" type="email" required autoComplete="email" disabled={pending} />
          <Field label="Пароль" name="password" type="password" minLength={8} maxLength={128} required autoComplete={mode === "login" ? "current-password" : "new-password"} disabled={pending} />
          {mode === "register" && <Field label="Повторите пароль" name="passwordConfirmation" type="password" minLength={8} maxLength={128} required autoComplete="new-password" disabled={pending} />}
          {visibleError && <div className="form-error" role="alert">{visibleError}</div>}
          <Button variant="primary" type="submit" className="mt-1 w-full" disabled={pending}>{pending ? "Подождите…" : mode === "login" ? "Открыть страну" : "Создать аккаунт"}</Button>
        </form>
        {mode === "login" && <Button variant="quiet" disabled={pending} onClick={() => setRecovering(true)}>Забыли пароль?</Button>}
        {canRetryCountry && <Button className="mt-2 w-full" disabled={pending} onClick={() => void retryCountryLoad()}>Повторить загрузку</Button>}
        {(registrationEnabled || mode === "register") && <Button variant="quiet" disabled={pending} className="mt-2 w-full" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); setCountryLoadFailed(false); }}>
          {mode === "login" ? "Нет аккаунта? Зарегистрироваться" : "Уже есть аккаунт? Войти"}
        </Button>}
      </AuthPanel>
    </section>
  </main>;
}
