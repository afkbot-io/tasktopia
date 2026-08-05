import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { BootstrapDto, CountryMemberDto, CountryRole } from "../../shared/contracts";
import { api, ApiError } from "../api";
import { Button, Field } from "./ui";

const roleLabel: Record<CountryRole, string> = { OWNER: "Глава страны", MEMBER: "Министр", VIEWER: "Наблюдатель" };

export function CountryPanel({ bootstrap, mode, onClose, onBootstrap }: {
  bootstrap: BootstrapDto;
  mode: "manage" | "create";
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
  const [regenerationNotice, setRegenerationNotice] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const loadMembers = useCallback(() => api<CountryMemberDto[]>(`/api/countries/${bootstrap.country.id}/members`).then(setMembers), [bootstrap.country.id]);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setRenameValue(bootstrap.country.name);
    if (mode === "manage") void loadMembers().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Не удалось открыть правительство"));
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
  }, [bootstrap.country.name, loadMembers, mode, onClose]);

  const safely = async (action: () => Promise<void>) => {
    setError(""); setPending(true);
    try { await action(); }
    catch (reason) { setError(reason instanceof ApiError ? reason.message : "Операция не выполнена"); }
    finally { setPending(false); }
  };
  const reloadBootstrap = async () => onBootstrap(await api<BootstrapDto>("/api/bootstrap"));
  const create = (event: FormEvent) => { event.preventDefault(); void safely(async () => {
    const country = await api<{ id: string }>("/api/countries", { method: "POST", json: { name: countryName } });
    const next = await api<BootstrapDto>(`/api/countries/${country.id}/select`, { method: "POST" });
    onBootstrap(next); onClose();
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
  const deleteCountry = () => void safely(async () => {
    if (!window.confirm(`Удалить страну «${bootstrap.country.name}» со всеми городами? Это действие нельзя отменить.`)) return;
    const result = await api<{ activeCountryId: string }>(`/api/countries/${bootstrap.country.id}`, { method: "DELETE" });
    onBootstrap(await api<BootstrapDto>(`/api/countries/${result.activeCountryId}/select`, { method: "POST" }));
    onClose();
  });
  const regenerateCountry = () => void safely(async () => {
    const confirmation = window.prompt(`Страна будет полностью перестроена, но города, районы, задачи, статусы и история сохранятся. Введите точное название:\n${bootstrap.country.name}`);
    if (confirmation == null) return;
    setRegenerationNotice("");
    const result = await api<{ cities: number; districts: number; tasks: number }>(`/api/countries/${bootstrap.country.id}/regenerate`, {
      method: "POST", json: { confirmName: confirmation, idempotencyKey: crypto.randomUUID() },
    });
    await reloadBootstrap();
    setRegenerationNotice(`Мир пересобран: ${result.cities} городов, ${result.districts} районов, ${result.tasks} зданий.`);
  });

  return <div className="fixed inset-0 z-50 grid place-items-center bg-[#020607]/85 p-0 backdrop-blur-md sm:p-4" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <section ref={panelRef} className="country-government-dialog" role="dialog" aria-modal="true" aria-labelledby="country-dialog-title">
      <header className="country-government-head">
        <div><p className="eyebrow">{mode === "create" ? "СОЗДАНИЕ СТРАНЫ" : "УПРАВЛЕНИЕ СТРАНОЙ"}</p><h2 id="country-dialog-title">{mode === "create" ? "Новая страна" : bootstrap.country.name}</h2><p>{mode === "create" ? "Дайте стране имя. После создания она откроется автоматически." : "Название, правительство и доступы выбранной страны."}</p></div>
        <Button ref={closeRef} variant="secondary" className="h-11 w-11 px-0 text-xl" onClick={onClose} aria-label="Закрыть">×</Button>
      </header>
      <div className="country-government-body">
        {error && <div role="alert" className="mb-4 rounded-xl border border-[#9b4d4d] bg-[#4a2025] px-4 py-3 text-sm text-[#ffd7d7]">{error}</div>}
        {mode === "create" ? <form className="country-create-form" onSubmit={create}>
          <span className="country-large-seal" aria-hidden="true">＋</span>
          <Field label="Название страны" value={countryName} onChange={(event) => setCountryName(event.target.value)} maxLength={100} minLength={2} required autoFocus placeholder="Например, Атутаелия" />
          <Button type="submit" disabled={pending || countryName.trim().length < 2}>{pending ? "Создаём…" : "Создать страну"}</Button>
        </form> : <div className="country-government-grid">
          <div className="grid content-start gap-5">
            {bootstrap.countryRole === "OWNER" && <section className="country-government-card">
              <h3>Название страны</h3><p>Новое название сразу появится в верхней панели.</p>
              <form className="mt-4 grid gap-2" onSubmit={rename}>
                <Field label="Название" value={renameValue} onChange={(event) => setRenameValue(event.target.value)} minLength={2} maxLength={100} required />
                <Button type="submit" disabled={pending || renameValue.trim() === bootstrap.country.name}>Сохранить название</Button>
              </form>
            </section>}
            <section className="country-government-card country-facts">
              <h3>Сведения</h3><dl><div><dt>Ваша роль</dt><dd>{roleLabel[bootstrap.countryRole]}</dd></div><div><dt>Участников правительства</dt><dd>{members.length}</dd></div><div><dt>Городов</dt><dd>{bootstrap.stats.cities}</dd></div></dl>
            </section>
            {bootstrap.countryRole === "OWNER" && <section className="country-government-card country-regeneration-card">
              <h3>Перегенерация мира</h3>
              <p>Создаёт новый рельеф, дороги, районы, здания и окружение. Названия, ID, статусы, ответственные, комментарии и хроника задач сохраняются.</p>
              <Button variant="secondary" className="mt-4" onClick={regenerateCountry} disabled={pending}>{pending ? "Перестраиваем мир…" : "Перегенерировать мир"}</Button>
              {regenerationNotice && <p className="country-regeneration-success" role="status">{regenerationNotice}</p>}
            </section>}
            {bootstrap.countryRole === "OWNER" && bootstrap.countries.length > 1 && <Button variant="danger" onClick={deleteCountry} disabled={pending}>Удалить страну</Button>}
          </div>
          <section className="country-government-card overflow-hidden p-0">
            <div className="government-title"><div><h3>Правительство</h3><p>Люди, которые могут управлять выбранной страной.</p></div><span>{members.length}</span></div>
            {bootstrap.countryRole === "OWNER" && <form className="government-invite" onSubmit={invite}>
              <Field label="Email участника" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.ru" required />
              <label>Полномочия<select aria-label="Полномочия" value={inviteRole} onChange={(event) => setInviteRole(event.target.value as typeof inviteRole)}><option value="MEMBER">Министр</option><option value="VIEWER">Наблюдатель</option></select></label>
              <Button type="submit" disabled={pending || !email.includes("@")}>Назначить</Button>
            </form>}
            <div className="government-list">{members.map((member) => <article key={member.userId}>
              <span>{member.name.slice(0, 1).toUpperCase()}</span><div><strong>{member.name}</strong><small>{member.email} · {roleLabel[member.role]}</small></div>
              {bootstrap.countryRole === "OWNER" && member.role !== "OWNER" && <Button variant="danger" onClick={() => removeMember(member.userId)} disabled={pending}>Исключить</Button>}
            </article>)}</div>
            {bootstrap.countryRole !== "OWNER" && <p className="government-readonly">Состав правительства изменяет глава страны.</p>}
          </section>
        </div>}
      </div>
    </section>
  </div>;
}
