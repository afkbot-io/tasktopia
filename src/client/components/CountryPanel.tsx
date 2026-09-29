import { useEffect, useRef, useState, type FormEvent } from "react";
import type {
  BootstrapDto,
  CountryMemberDto,
  CountryRole,
} from "../../shared/contracts";
import { api } from "../api";
import { useDialogFocus } from "../use-dialog-focus";
import { Button, Field } from "./ui";

const roleLabel: Record<CountryRole, string> = {
  OWNER: "Глава страны",
  MEMBER: "Министр",
  VIEWER: "Наблюдатель",
};

/** Рабочие данные — через MCP; доступ к стране управляется её главой. */
export function CountryPanel(props: { bootstrap: BootstrapDto; onClose: () => void }) {
  return <CountryGovernment key={props.bootstrap.country.id} {...props} />;
}

function CountryGovernment({
  bootstrap,
  onClose,
}: {
  bootstrap: BootstrapDto;
  onClose: () => void;
}) {
  const [members, setMembers] = useState<CountryMemberDto[] | null>(null);
  const [error, setError] = useState("");
  const [inviting, setInviting] = useState(false);
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"MEMBER" | "VIEWER">("MEMBER");
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const isOwner = bootstrap.countryRole === "OWNER";
  const [retry, setRetry] = useState(0);
  const panelRef = useRef<HTMLElement>(null);
  useDialogFocus(panelRef);
  useEffect(() => {
    const controller = new AbortController();
    setMembers(null);
    setError("");
    void api<CountryMemberDto[]>(
      `/api/countries/${bootstrap.country.id}/members`,
      { signal: controller.signal },
    )
      .then((value) => {
        if (!controller.signal.aborted) setMembers(value);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error
              ? reason.message
              : "Не удалось открыть правительство",
          );
      });
    return () => controller.abort();
  }, [bootstrap.country.id, retry]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const mutate = async (work: () => Promise<void>) => {
    if (busyRef.current || !isOwner) return;
    busyRef.current = true;
    setBusy(true);
    setActionError("");
    setNotice("");
    try { await work(); }
    catch (reason) { setActionError(reason instanceof Error ? reason.message : "Не удалось изменить доступ. Попробуйте ещё раз."); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const invite = (event: FormEvent) => {
    event.preventDefault();
    void mutate(async () => {
      const member = await api<CountryMemberDto>(`/api/countries/${bootstrap.country.id}/members`, {
        method: "POST", json: { email: email.trim(), role: inviteRole },
      });
      setMembers(current => current ? [...current.filter(item => item.userId !== member.userId), member] : [member]);
      setEmail("");
      setInviting(false);
      setNotice(`Доступ открыт: ${member.name}. Страна появится в его списке стран.`);
    });
  };
  const remove = (member: CountryMemberDto) => void mutate(async () => {
    await api(`/api/countries/${bootstrap.country.id}/members/${member.userId}`, { method: "DELETE" });
    setMembers(current => current?.filter(item => item.userId !== member.userId) ?? null);
    setPendingRemoval(null);
    setNotice(`Доступ закрыт: ${member.name}. Задачи и история сохранены.`);
  });
  const country = bootstrap.country;
  const facts = [
    ["Описание", country.description],
    ["Цель развития", country.goal],
    ["О стране", country.productContext],
    ["Условия успеха", country.successCriteria],
    ["Ограничения", country.constraints],
  ];
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        ref={panelRef}
        className="country-government-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="country-dialog-title"
      >
        <header className="country-government-head">
          <div>
            <p className="eyebrow">ПАСПОРТ СТРАНЫ</p>
            <h2 id="country-dialog-title">{country.name}</h2>
            <p>Цель развития и правительство.</p>
          </div>
          <Button
            variant="secondary"
            className="h-11 w-11 px-0 text-xl"
            onClick={onClose}
            aria-label="Закрыть"
          >
            ×
          </Button>
        </header>
        <div className="country-government-body country-government-grid">
          <section className="country-government-card country-facts">
            <h3>Паспорт страны</h3>
            <dl>
              {facts
                .filter(([, value]) => value?.trim())
                .map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd className="country-passport-text">{value}</dd>
                  </div>
                ))}
              <div>
                <dt>Ваша роль</dt>
                <dd>{roleLabel[bootstrap.countryRole]}</dd>
              </div>
              <div>
                <dt>Городов</dt>
                <dd>{bootstrap.stats.cities}</dd>
              </div>
            </dl>
          </section>
          <section className="country-government-card overflow-hidden p-0">
            <div className="government-title">
              <h3>Правительство</h3>
              {members && <span>{members.length}</span>}
            </div>
            {isOwner && members && <div className="government-access">
              {!inviting ? <Button disabled={busy} onClick={() => { setInviting(true); setPendingRemoval(null); setActionError(""); setNotice(""); }}>Пригласить участника</Button> : <form onSubmit={invite} className="government-access-form">
                <p id="government-invite-help">Укажите email зарегистрированного пользователя. Доступ откроется сразу; письмо не отправляется.</p>
                <Field label="Email участника" type="email" autoComplete="email" maxLength={254} required value={email} disabled={busy} aria-describedby="government-invite-help" onChange={event => setEmail(event.target.value)} />
                <label>Полномочия<select value={inviteRole} disabled={busy} onChange={event => setInviteRole(event.target.value as "MEMBER" | "VIEWER")}><option value="MEMBER">Министр</option><option value="VIEWER">Наблюдатель</option></select></label>
                <p>Министр управляет работой через MCP. Наблюдатель может только просматривать.</p>
                <div className="government-access-actions"><Button type="submit" variant="primary" disabled={busy}>{busy ? "Открываем доступ…" : "Открыть доступ"}</Button><Button disabled={busy} aria-label="Отмена приглашения" onClick={() => { setInviting(false); setActionError(""); }}>Отмена</Button></div>
              </form>}
            </div>}
            {actionError && <p className="government-readonly" role="alert">{actionError}</p>}
            {notice && <p className="government-readonly" role="status">{notice}</p>}
            {error ? (
              <p role="alert" className="government-readonly">
                {error}{" "}
                <Button
                  variant="secondary"
                  onClick={() => setRetry((value) => value + 1)}
                >
                  Повторить
                </Button>
              </p>
            ) : !members ? (
              <p role="status" className="government-readonly">
                Загружаем состав…
              </p>
            ) : (
              <div className="government-list">
                {members.map((member) => (
                  <article key={member.userId}>
                    <span aria-hidden="true">
                      {member.name.slice(0, 1).toUpperCase()}
                    </span>
                    <div>
                      <strong>{member.name}</strong>
                      <small>
                        {member.email} · {roleLabel[member.role]}
                      </small>
                    </div>
                    {isOwner && member.role !== "OWNER" && <div className="government-member-actions">
                      {pendingRemoval === member.userId ? <>
                        <p>Закрыть доступ для {member.name}? Задачи и история останутся.</p>
                        <div className="government-access-actions"><Button variant="danger" disabled={busy} aria-label="Подтвердить отзыв доступа" onClick={() => remove(member)}>{busy ? "Закрываем…" : "Подтвердить"}</Button><Button disabled={busy} onClick={() => setPendingRemoval(null)}>Отмена</Button></div>
                      </> : <Button variant="quiet" disabled={busy} onClick={() => { setPendingRemoval(member.userId); setInviting(false); setActionError(""); setNotice(""); }}>Закрыть доступ</Button>}
                    </div>}
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}
