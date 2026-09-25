import { useEffect, useRef, useState } from "react";
import type {
  BootstrapDto,
  CountryMemberDto,
  CountryRole,
} from "../../shared/contracts";
import { api } from "../api";
import { useDialogFocus } from "../use-dialog-focus";
import { Button } from "./ui";

const roleLabel: Record<CountryRole, string> = {
  OWNER: "Глава страны",
  MEMBER: "Министр",
  VIEWER: "Наблюдатель",
};

/** Рабочие данные меняет агент через MCP. Паспорт доступен всем участникам. */
export function CountryPanel({
  bootstrap,
  onClose,
}: {
  bootstrap: BootstrapDto;
  onClose: () => void;
}) {
  const [members, setMembers] = useState<CountryMemberDto[] | null>(null);
  const [error, setError] = useState("");
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
