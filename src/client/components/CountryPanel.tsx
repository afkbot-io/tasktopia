import { useCallback, useEffect, useRef, useState } from "react";
import type { BootstrapDto, CountryMemberDto, CountryRole } from "../../shared/contracts";
import { api, ApiError } from "../api";

export function CountryPanel({ bootstrap, onClose, onBootstrap }: {
  bootstrap: BootstrapDto;
  onClose: () => void;
  onBootstrap: (bootstrap: BootstrapDto) => void;
}) {
  const [members, setMembers] = useState<CountryMemberDto[]>([]);
  const [countryName, setCountryName] = useState("");
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Extract<CountryRole, "MEMBER" | "VIEWER">>("MEMBER");
  const [error, setError] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);
  const loadMembers = useCallback(() => api<CountryMemberDto[]>(`/api/countries/${bootstrap.country.id}/members`).then(setMembers), [bootstrap.country.id]);

  useEffect(() => {
    void loadMembers().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Не удалось открыть палату"));
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [loadMembers, onClose]);

  const safely = async (action: () => Promise<void>) => {
    setError("");
    try { await action(); } catch (reason) { setError(reason instanceof ApiError ? reason.message : "Операция не выполнена"); }
  };

  const selectCountry = (countryId: string) => safely(async () => {
    const next = await api<BootstrapDto>(`/api/countries/${countryId}/select`, { method: "POST" });
    onBootstrap(next);
  });

  const create = () => safely(async () => {
    const country = await api<{ id: string }>("/api/countries", { method: "POST", body: JSON.stringify({ name: countryName }) });
    setCountryName("");
    await selectCountry(country.id);
  });

  const invite = () => safely(async () => {
    await api(`/api/countries/${bootstrap.country.id}/members`, { method: "POST", body: JSON.stringify({ email, role: inviteRole }) });
    setEmail("");
    await loadMembers();
  });

  const removeMember = (userId: string) => safely(async () => {
    await api(`/api/countries/${bootstrap.country.id}/members/${userId}`, { method: "DELETE" });
    await loadMembers();
  });

  const deleteCountry = (countryId: string, name: string) => safely(async () => {
    if (!window.confirm(`Удалить страну «${name}» со всеми городами? Это действие нельзя отменить.`)) return;
    const result = await api<{ activeCountryId: string }>(`/api/countries/${countryId}`, { method: "DELETE" });
    await selectCountry(result.activeCountryId);
  });

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <section className="country-panel" role="dialog" aria-modal="true" aria-labelledby="countries-title">
      <button ref={closeRef} className="modal-close" onClick={onClose} aria-label="Закрыть">×</button>
      <p className="eyebrow">УПРАВЛЕНИЕ МИРОМ</p><h2 id="countries-title">Страны и палата</h2>
      {error && <div className="form-error">{error}</div>}
      <div className="country-layout">
        <section className="country-list"><h3>Ваши страны</h3>
          {bootstrap.countries.map((country) => <article className={country.id === bootstrap.country.id ? "selected" : ""} key={country.id}>
            <button className="country-select" onClick={() => void selectCountry(country.id)}><strong>{country.name}</strong><span>{country.role === "OWNER" ? "Основатель" : country.role === "VIEWER" ? "Наблюдатель" : "Редактор"} · {country.memberCount} чел.</span></button>
            {country.role === "OWNER" && country.id === bootstrap.country.id && bootstrap.countries.length > 1 && <button className="danger-icon" onClick={() => void deleteCountry(country.id, country.name)} title="Удалить страну">×</button>}
          </article>)}
          <div className="inline-create"><input value={countryName} onChange={(event) => setCountryName(event.target.value)} placeholder="Название новой страны" maxLength={100} /><button onClick={() => void create()} disabled={countryName.trim().length < 2}>Создать</button></div>
        </section>
        <section className="chamber-list"><h3>Палата страны <span>{members.length}</span></h3>
          {bootstrap.countryRole === "OWNER" && <div className="inline-create"><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="email зарегистрированного человека" /><select aria-label="Роль приглашения" value={inviteRole} onChange={(event) => setInviteRole(event.target.value as typeof inviteRole)}><option value="MEMBER">Редактор</option><option value="VIEWER">Наблюдатель</option></select><button onClick={() => void invite()} disabled={!email.includes("@")}>Добавить</button></div>}
          {members.map((member) => <article key={member.userId}><span className="member-avatar">{member.name.slice(0, 1).toUpperCase()}</span><div><strong>{member.name}</strong><small>{member.email} · {member.role === "OWNER" ? "Основатель" : member.role === "VIEWER" ? "Наблюдатель" : "Редактор"}</small></div>{bootstrap.countryRole === "OWNER" && member.role !== "OWNER" && <button onClick={() => void removeMember(member.userId)}>Исключить</button>}</article>)}
          {bootstrap.countryRole === "MEMBER" && <p className="muted chamber-note">Вы можете развивать города и задачи. Составом палаты управляет основатель страны.</p>}
          {bootstrap.countryRole === "VIEWER" && <p className="muted chamber-note">У вас доступ только для чтения карты, плана и задач.</p>}
        </section>
      </div>
    </section>
  </div>;
}
