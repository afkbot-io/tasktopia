import { RecoveryScreen } from "./RecoveryScreen";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../api";
import { Button, Field } from "./ui";
import { AuthPanel } from './AuthPanel';
import { AuthLayout } from './AuthLayout';
import { focusAuthFieldError, readAuthFieldErrors, type AuthFieldErrors } from '../auth-form-validation';

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
  const [configState,setConfigState]=useState<'loading'|'ready'|'error'>('loading');
  const [configAttempt,setConfigAttempt]=useState(0);
  const [fieldErrors,setFieldErrors]=useState<AuthFieldErrors>({});
  const [registerStep, setRegisterStep] = useState<0 | 1>(0);
  const accountDraft = useRef<Record<string, FormDataEntryValue>>({});
  const formRef = useRef<HTMLFormElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const visibleError = error || initialError;

  useEffect(()=>{if(visibleError)errorRef.current?.focus();},[visibleError]);

  useEffect(() => {
    if (mode === 'register') formRef.current?.querySelector<HTMLInputElement>(registerStep === 1 ? '[name="countryName"]' : '[name="name"]')?.focus();
  }, [mode, registerStep]);

  useEffect(() => {
    let active = true;
    const controller=new AbortController();
    const deadline=window.setTimeout(()=>controller.abort(),8000);
    void api<{ registrationEnabled: boolean }>("/api/auth/config",{signal:controller.signal})
      .then((result) => {
        if(typeof result.registrationEnabled!=='boolean')throw new Error('Invalid auth config');
        if (active) {setRegistrationEnabled(result.registrationEnabled);setConfigState('ready');}
      })
      .catch(() => {
        if (active) setConfigState('error');
      }).finally(()=>window.clearTimeout(deadline));
    return () => { active = false; window.clearTimeout(deadline);controller.abort(); };
  }, [configAttempt]);

  useEffect(() => {
    if (!registrationEnabled && mode === "register") setMode("login");
  }, [mode, registrationEnabled]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const form=event.currentTarget,errors=readAuthFieldErrors(form);
    setFieldErrors(errors);
    if(Object.keys(errors).length){setError('');window.requestAnimationFrame(()=>focusAuthFieldError(form,errors));return;}
    const data = new FormData(event.currentTarget);
    if (mode === 'register' && registerStep === 0) {
      accountDraft.current = Object.fromEntries(data);
      setError(''); setRegisterStep(1); return;
    }
    submitting.current = true;
    setPending(true);
    setError("");
    try {
      const body = mode === "register"
        ? {
            email: accountDraft.current.email, password: accountDraft.current.password, passwordConfirmation: accountDraft.current.passwordConfirmation, name: accountDraft.current.name,
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

  const canRetryCountry = countryLoadFailed || Boolean(initialError);

  if (recovering) return <RecoveryScreen onBack={() => setRecovering(false)} />;
  const changeMode = (next: 'login' | 'register') => {
    if (next === mode) return;
    formRef.current?.reset(); accountDraft.current = {}; setRegisterStep(0); setMode(next); setError(''); setFieldErrors({});setCountryLoadFailed(false);
  };
  return <AuthLayout>
      <AuthPanel title={mode === 'login' ? 'Войти в Tasktopia' : 'Создать аккаунт'}>
        {(configState==='error'||configState==='loading'&&configAttempt>0)&&<div className="auth-config-status" role="status">
          <p>{configState==='error'?'Не удалось проверить доступность регистрации. Войти в аккаунт можно.':'Проверяем доступность регистрации…'}</p>
          <Button variant="quiet" disabled={configState==='loading'} onClick={()=>{setConfigState('loading');setConfigAttempt(current=>current+1);}}>Повторить проверку регистрации</Button>
        </div>}
        {registrationEnabled && <nav className="auth-mode-switch" aria-label="Доступ в Tasktopia">
          <Button aria-pressed={mode === 'login'} disabled={pending} onClick={() => changeMode('login')}>Вход</Button>
          <Button aria-pressed={mode === 'register'} disabled={pending} onClick={() => changeMode('register')}>Регистрация</Button>
        </nav>}
        {mode === 'login' ? <p className="auth-form-description">Продолжите работу в своей стране.</p> : <ol className="auth-registration-steps" aria-label="Этапы регистрации">
          <li aria-current={registerStep === 0 ? 'step' : undefined}><span>1</span> Аккаунт</li>
          <li aria-current={registerStep === 1 ? 'step' : undefined}><span>2</span> Первый город</li>
        </ol>}
        <form ref={formRef} noValidate onSubmit={submit} className="auth-entry-form" onInput={event=>{
          const input=event.target;if(!(input instanceof HTMLInputElement))return;
          setFieldErrors(current=>{if(!current[input.name])return current;const next={...current};delete next[input.name];return next;});setError('');
        }}>
          <fieldset hidden={mode === 'register' && registerStep === 1} disabled={pending || mode === 'register' && registerStep === 1}>
            {mode === 'register' && <Field label="Имя" name="name" error={fieldErrors.name} minLength={2} maxLength={60} required autoComplete="name" />}
            <Field label="Email" name="email" error={fieldErrors.email} type="email" maxLength={254} required autoComplete="email" />
            <Field label="Пароль" name="password" error={fieldErrors.password} type="password" minLength={8} maxLength={128} required autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
            {mode === 'register' && <Field label="Повторите пароль" name="passwordConfirmation" error={fieldErrors.passwordConfirmation} type="password" minLength={8} maxLength={128} required autoComplete="new-password" />}
          </fieldset>
          {mode === 'register' && <fieldset hidden={registerStep === 0} disabled={pending || registerStep === 0}>
            <p className="auth-form-description">Дайте имя своей стране и первому городу. Названия появятся на карте.</p>
            <Field label="Название вашей первой страны" name="countryName" error={fieldErrors.countryName} minLength={2} maxLength={100} required placeholder="Например, Атутаелия" />
            <Field label="Название первого города" name="cityName" error={fieldErrors.cityName} minLength={2} maxLength={100} required placeholder="Например, Столица" />
          </fieldset>}
          {visibleError && <div ref={errorRef} className="form-error" role="alert" tabIndex={-1}>{visibleError}</div>}
          <Button variant="primary" type="submit" className="auth-submit" disabled={pending}>{pending ? 'Подождите…' : mode === 'login' ? 'Открыть страну' : registerStep === 0 ? 'Продолжить' : 'Создать аккаунт'}</Button>
          {mode === 'register' && registerStep === 1 && <Button variant="quiet" disabled={pending} onClick={() => {setRegisterStep(0);setError('');setFieldErrors({});}}>Назад к аккаунту</Button>}
        </form>
        {mode === "login" && <Button variant="quiet" disabled={pending} onClick={() => setRecovering(true)}>Забыли пароль?</Button>}
        {canRetryCountry && <Button className="mt-2 w-full" disabled={pending} onClick={() => void retryCountryLoad()}>Повторить загрузку</Button>}
      </AuthPanel>
  </AuthLayout>;
}
