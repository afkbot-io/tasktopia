import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { BootstrapDto, CountryMemberDto, CountryRole } from "../../shared/contracts";
import { api, ApiError } from "../api";
import { Button, Field, cx } from "./ui";

const roleLabel: Record<CountryRole, string> = { OWNER: "Основатель", MEMBER: "Редактор", VIEWER: "Наблюдатель" };

export function CountryPanel({ bootstrap, onClose, onBootstrap }: {
  bootstrap: BootstrapDto;
  onClose: () => void;
  onBootstrap: (bootstrap: BootstrapDto) => void;
}) {
  const [members, setMembers] = useState<CountryMemberDto[]>([]);
  const [countryName, setCountryName] = useState("");
  const [renameValue, setRenameValue] = useState(bootstrap.country.name);
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Extract<CountryRole, "MEMBER" | "VIEWER">>("MEMBER");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const loadMembers = useCallback(() => api<CountryMemberDto[]>(`/api/countries/${bootstrap.country.id}/members`).then(setMembers), [bootstrap.country.id]);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setRenameValue(bootstrap.country.name);
    void loadMembers().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Не удалось открыть палату"));
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { onClose(); return; }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = [...panelRef.current.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), [href], [tabindex]:not([tabindex='-1'])")];
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); previouslyFocused?.focus({ preventScroll: true }); };
  }, [bootstrap.country.name, loadMembers, onClose]);

  const safely = async (action: () => Promise<void>) => {
    setError(""); setPending(true);
    try { await action(); }
    catch (reason) { setError(reason instanceof ApiError ? reason.message : "Операция не выполнена"); }
    finally { setPending(false); }
  };

  const reloadBootstrap = async () => onBootstrap(await api<BootstrapDto>("/api/bootstrap"));
  const selectCountry = (countryId: string) => safely(async () => {
    onBootstrap(await api<BootstrapDto>(`/api/countries/${countryId}/select`, { method: "POST" }));
  });
  const create = (event: FormEvent) => { event.preventDefault(); void safely(async () => {
    const country = await api<{ id: string }>("/api/countries", { method: "POST", json: { name: countryName } });
    setCountryName("");
    onBootstrap(await api<BootstrapDto>(`/api/countries/${country.id}/select`, { method: "POST" }));
  }); };
  const rename = (event: FormEvent) => { event.preventDefault(); void safely(async () => {
    await api(`/api/countries/${bootstrap.country.id}`, { method: "PATCH", json: { name: renameValue } });
    await reloadBootstrap();
  }); };
  const invite = (event: FormEvent) => { event.preventDefault(); void safely(async () => {
    await api(`/api/countries/${bootstrap.country.id}/members`, { method: "POST", json: { email, role: inviteRole } });
    setEmail(""); await loadMembers();
  }); };
  const removeMember = (userId: string) => void safely(async () => {
    await api(`/api/countries/${bootstrap.country.id}/members/${userId}`, { method: "DELETE" }); await loadMembers();
  });
  const deleteCountry = (countryId: string, name: string) => void safely(async () => {
    if (!window.confirm(`Удалить страну «${name}» со всеми городами? Это действие нельзя отменить.`)) return;
    const result = await api<{ activeCountryId: string }>(`/api/countries/${countryId}`, { method: "DELETE" });
    onBootstrap(await api<BootstrapDto>(`/api/countries/${result.activeCountryId}/select`, { method: "POST" }));
  });

  return <div className="fixed inset-0 z-50 grid place-items-center bg-[#020607]/85 p-0 backdrop-blur-md sm:p-4" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <section ref={panelRef} className="relative grid h-dvh w-full grid-rows-[auto_minmax(0,1fr)] overflow-hidden border-[#38545d] bg-[#0e1d21] shadow-[0_30px_100px_#000c] sm:h-auto sm:max-h-[min(860px,calc(100dvh-32px))] sm:max-w-6xl sm:rounded-3xl sm:border" role="dialog" aria-modal="true" aria-labelledby="countries-title">
      <header className="relative border-b border-[#29434a] bg-[#112329] px-5 py-5 pr-20 sm:px-8 sm:py-7">
        <p className="eyebrow">УПРАВЛЕНИЕ МИРОМ</p>
        <h2 id="countries-title" className="m-0 text-3xl font-black tracking-[-.045em] text-[#f1f2e8] sm:text-4xl">Страны и команда</h2>
        <p className="mb-0 mt-2 max-w-2xl text-sm leading-6 text-[#8da3a7]">Страна — отдельный проект. Переключайтесь между проектами, меняйте название и управляйте доступом команды.</p>
        <Button ref={closeRef} variant="secondary" className="absolute right-4 top-4 h-11 w-11 px-0 text-xl sm:right-6 sm:top-6" onClick={onClose} aria-label="Закрыть">×</Button>
      </header>

      <div className="min-h-0 overflow-y-auto p-4 sm:p-6">
        {error && <div role="alert" className="mb-4 rounded-xl border border-[#9b4d4d] bg-[#4a2025] px-4 py-3 text-sm text-[#ffd7d7]">{error}</div>}
        <div className="grid gap-5 lg:grid-cols-[minmax(280px,.8fr)_minmax(420px,1.2fr)]">
          <div className="grid content-start gap-5">
            <section className="overflow-hidden rounded-2xl border border-[#2d4850] bg-[#0a171a]">
              <div className="flex items-center justify-between border-b border-[#294149] px-4 py-3"><h3 className="m-0 text-xs font-black uppercase tracking-[.13em] text-[#9aadb0]">Ваши страны</h3><span className="font-mono text-xs text-skyline">{bootstrap.countries.length}</span></div>
              <div className="grid gap-1 p-2">
                {bootstrap.countries.map((country) => <div className={cx("grid grid-cols-[minmax(0,1fr)_auto] items-center rounded-xl border border-transparent", country.id === bootstrap.country.id && "border-[#3f6874] bg-[#17333b]")} key={country.id}>
                  <button className="grid min-h-14 min-w-0 gap-1 rounded-xl px-3 py-2 text-left hover:bg-[#173038]" onClick={() => void selectCountry(country.id)} disabled={pending}>
                    <strong className="truncate text-sm text-[#e9ede5]">{country.name}</strong>
                    <span className="text-[11px] text-[#a6b8ba]">{roleLabel[country.role]} · {country.memberCount} чел.</span>
                  </button>
                  {country.role === "OWNER" && country.id === bootstrap.country.id && bootstrap.countries.length > 1 && <Button variant="danger" className="mr-2 h-10 min-h-10 w-10 px-0" onClick={() => deleteCountry(country.id, country.name)} title="Удалить страну" aria-label={`Удалить страну ${country.name}`}>×</Button>}
                </div>)}
              </div>
            </section>

            {bootstrap.countryRole === "OWNER" && <section className="rounded-2xl border border-[#2d4850] bg-[#0a171a] p-4">
              <h3 className="m-0 text-sm font-black text-[#e7ece5]">Название проекта</h3>
              <p className="mt-1 text-xs leading-5 text-[#82999d]">Новое название сразу появится в верхней панели.</p>
              <form className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]" onSubmit={rename}>
                <Field label="Название страны" className="min-h-11" value={renameValue} onChange={(event) => setRenameValue(event.target.value)} minLength={2} maxLength={100} required />
                <Button type="submit" className="self-end" disabled={pending || renameValue.trim() === bootstrap.country.name}>Сохранить</Button>
              </form>
            </section>}

            <section className="rounded-2xl border border-dashed border-[#39545d] bg-[#0c1a1e] p-4">
              <h3 className="m-0 text-sm font-black text-[#e7ece5]">Новая страна</h3>
              <p className="mt-1 text-xs leading-5 text-[#82999d]">Создайте ещё один независимый проект.</p>
              <form className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]" onSubmit={create}>
                <Field label="Название новой страны" value={countryName} onChange={(event) => setCountryName(event.target.value)} maxLength={100} minLength={2} required />
                <Button type="submit" className="self-end" disabled={pending || countryName.trim().length < 2}>Создать</Button>
              </form>
            </section>
          </div>

          <section className="overflow-hidden rounded-2xl border border-[#2d4850] bg-[#0a171a]">
            <div className="flex items-center justify-between border-b border-[#294149] px-4 py-3"><div><h3 className="m-0 text-xs font-black uppercase tracking-[.13em] text-[#9aadb0]">Команда страны</h3><p className="mb-0 mt-1 text-xs text-[#718a8f]">Доступ действует только внутри выбранного проекта.</p></div><span className="font-mono text-xs text-skyline">{members.length}</span></div>
            {bootstrap.countryRole === "OWNER" && <form className="grid gap-3 border-b border-[#263e45] p-4 sm:grid-cols-[minmax(0,1fr)_150px_auto]" onSubmit={invite}>
              <Field label="Email участника" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.ru" required />
              <label className="grid gap-1.5 text-sm font-bold text-[#c7d2d1]">Роль<select className="min-h-12 rounded-xl border border-[#34515a] bg-[#091518] px-3 text-[#f0f3e9]" aria-label="Роль приглашения" value={inviteRole} onChange={(event) => setInviteRole(event.target.value as typeof inviteRole)}><option value="MEMBER">Редактор</option><option value="VIEWER">Наблюдатель</option></select></label>
              <Button type="submit" className="self-end" disabled={pending || !email.includes("@")}>Добавить</Button>
            </form>}
            <div className="grid gap-1 p-2">
              {members.map((member) => <article className="grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-2 py-2.5 hover:bg-[#10252b]" key={member.userId}>
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-[#24424c] font-black text-[#8ccce5]">{member.name.slice(0, 1).toUpperCase()}</span>
                <div className="min-w-0"><strong className="block truncate text-sm text-[#e8ede5]">{member.name}</strong><small className="block truncate text-[11px] text-[#82999d]">{member.email} · {roleLabel[member.role]}</small></div>
                {bootstrap.countryRole === "OWNER" && member.role !== "OWNER" && <Button variant="danger" className="min-h-10 px-3 text-xs" onClick={() => removeMember(member.userId)}>Исключить</Button>}
              </article>)}
            </div>
            {bootstrap.countryRole !== "OWNER" && <p className="mx-4 mb-4 rounded-xl bg-[#10252b] p-3 text-xs leading-5 text-[#8da3a7]">{bootstrap.countryRole === "MEMBER" ? "Вы можете развивать города и задачи. Доступами управляет основатель страны." : "У вас доступ только для чтения карты, плана и задач."}</p>}
          </section>
        </div>
      </div>
    </section>
  </div>;
}
