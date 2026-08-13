import { useEffect, useRef, useState } from "react";
import type { BootstrapDto, CountryRole } from "../../shared/contracts";
import { api, ApiError } from "../api";
import { cx } from "./ui";

const roleLabel: Record<CountryRole, string> = {
  OWNER: "Глава страны",
  MEMBER: "Министр",
  VIEWER: "Наблюдатель",
};

export function CountrySwitcher({ bootstrap, onClose, onBootstrap, onManage, onCreate }: {
  bootstrap: BootstrapDto;
  onClose: () => void;
  onBootstrap: (bootstrap: BootstrapDto) => void;
  onManage: () => void;
  onCreate: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [pendingId, setPendingId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest(".country-title-button")) return;
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("pointerdown", closeOutside, true);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside, true);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  const selectCountry = async (countryId: string) => {
    if (countryId === bootstrap.country.id) { onClose(); return; }
    setPendingId(countryId);
    setError("");
    try {
      onBootstrap(await api<BootstrapDto>(`/api/countries/${countryId}/select`, { method: "POST" }));
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "Не удалось открыть страну");
      setPendingId("");
    }
  };

  return <div ref={rootRef} className="country-switcher" role="dialog" aria-label="Выбор страны">
    <div className="country-switcher-head"><span>Ваши страны</span><strong>{bootstrap.countries.length}</strong></div>
    {error && <div className="country-switcher-error" role="alert">{error}</div>}
    <div className="country-switcher-list">
      {bootstrap.countries.map((country) => <button
        type="button"
        key={country.id}
        className={cx("country-switcher-item", country.id === bootstrap.country.id && "selected")}
        aria-current={country.id === bootstrap.country.id ? "true" : undefined}
        disabled={Boolean(pendingId)}
        onClick={() => void selectCountry(country.id)}
      >
        <span className="country-switcher-seal">{country.name.slice(0, 1).toUpperCase()}</span>
        <span><strong>{country.name}</strong><small>{roleLabel[country.role]} · {country.memberCount} чел.</small></span>
        {country.id === bootstrap.country.id && <i aria-hidden="true">✓</i>}
        {pendingId === country.id && <i aria-label="Открываем страну">…</i>}
      </button>)}
    </div>
    <div className="country-switcher-actions">
      <button type="button" onClick={onManage}>Редактировать страну</button>
      <button type="button" className="country-create-action" onClick={onCreate}>＋ Новая страна</button>
    </div>
  </div>;
}
