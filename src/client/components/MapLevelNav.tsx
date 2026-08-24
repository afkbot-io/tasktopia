import { cx } from "./ui";

export type MapLevel = "PLANET" | "COUNTRY" | "CITY";

export function MapLevelNav({ level, hasCity, onChange }: {
  level: MapLevel;
  hasCity: boolean;
  onChange: (level: MapLevel) => void;
}) {
  return <nav className="map-level-nav" aria-label="Уровень карты">
    {(["PLANET", "COUNTRY", "CITY"] as const).map((candidate) => {
      const disabled = candidate === "COUNTRY" ? level === "PLANET" : candidate === "CITY" ? level !== "CITY" || !hasCity : false;
      const label = candidate === "PLANET" ? "Планета" : candidate === "COUNTRY" ? "Страна" : "Город";
      return <button
        key={candidate}
        type="button"
        className={cx("map-level-button", candidate === level && "map-level-button-active")}
        aria-current={candidate === level ? "page" : undefined}
        disabled={disabled}
        onClick={() => onChange(candidate)}
      >{label}</button>;
    })}
  </nav>;
}
