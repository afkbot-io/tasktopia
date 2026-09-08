import { cx } from "./ui";

export type MapLevel = "PLANET" | "COUNTRY" | "CITY";

export function MapLevelNav({ level, hasCity, showDistricts = false, onDistrictsChange, onChange }: {
  level: MapLevel;
  hasCity: boolean;
  showDistricts?: boolean;
  onDistrictsChange?: (visible: boolean) => void;
  onChange: (level: MapLevel) => void;
}) {
  return <nav className="map-level-nav" aria-label="Уровень карты">
    {(["PLANET", "COUNTRY", "CITY"] as const).map((candidate) => {
      const disabled = candidate === "CITY" && !hasCity;
      const label = candidate === "PLANET" ? "Планета" : candidate === "COUNTRY" ? "Страна" : "Город";
      return <button
        key={candidate}
        type="button"
        className={cx("map-level-button", candidate === level && !(candidate === "CITY" && showDistricts) && "map-level-button-active")}
        aria-current={candidate === level && !(candidate === "CITY" && showDistricts) ? "page" : undefined}
        disabled={disabled}
        onClick={() => { if (candidate === "CITY") onDistrictsChange?.(false); if (candidate !== level) onChange(candidate); }}
      >{label}</button>;
    })}
    {onDistrictsChange && <button type="button" disabled={!hasCity}
      className={cx("map-level-button", level === "CITY" && showDistricts && "map-level-button-active")}
      aria-pressed={level === "CITY" && showDistricts}
      onClick={() => { onDistrictsChange(true); if (level !== "CITY") onChange("CITY"); }}>Районы</button>}
  </nav>;
}
