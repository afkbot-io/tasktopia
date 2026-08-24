import { useEffect, useMemo, useState } from "react";
import { PLANET_ATLAS_SCHEMA_VERSION, type PlanetAtlasDto } from "../../shared/planet-atlas-contract";
import { planetHexCenter, planetHexPath, projectPlanetAtlas, type ProjectedPlanetCountry } from "../../shared/planet-atlas";
import { api } from "../api";
import { planetAtlasCacheKey } from "../planet-atlas-cache";
import { AtlasAircraft } from "./AtlasAircraft";

function readCachedPlanet(userId: string): PlanetAtlasDto | null {
  try {
    const value = window.sessionStorage.getItem(planetAtlasCacheKey(userId));
    if (!value) return null;
    const parsed = JSON.parse(value) as PlanetAtlasDto;
    return parsed.schemaVersion === PLANET_ATLAS_SCHEMA_VERSION ? parsed : null;
  } catch { return null; }
}

function writeCachedPlanet(userId: string, atlas: PlanetAtlasDto): void {
  try { window.sessionStorage.setItem(planetAtlasCacheKey(userId), JSON.stringify(atlas)); } catch { /* Optional first-paint cache. */ }
}

function CountryLabel({ country }: { country: ProjectedPlanetCountry }) {
  const width = Math.max(76, Math.min(150, country.name.length * 8 + 28));
  const displayName = country.name.length > 18 ? `${country.name.slice(0, 17)}…` : country.name;
  return <g className="planet-country-label" transform={`translate(${country.center.x - width / 2} ${country.center.y + 15})`} aria-hidden="true">
    <rect width={width} height="31" />
    <rect className="planet-country-progress-track" x="8" y="24" width={width - 16} height="3" />
    <rect className="planet-country-progress-value" x="8" y="24" width={(width - 16) * country.progress / 100} height="3" />
    <text x={width / 2} y="13" textAnchor="middle">{displayName}</text>
    <text className="planet-country-meta" x={width / 2} y="21" textAnchor="middle">{country.cityCount} ГОРОДОВ</text>
  </g>;
}

export function PlanetAtlasCanvas({ userId, activeCountryId, refreshToken, onCountrySelect }: {
  userId: string;
  activeCountryId: string;
  refreshToken: number;
  onCountrySelect: (countryId: string) => Promise<void> | void;
}) {
  const [atlas, setAtlas] = useState<PlanetAtlasDto | null>(() => readCachedPlanet(userId));
  const [error, setError] = useState("");
  const [selectingCountryId, setSelectingCountryId] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setAtlas(readCachedPlanet(userId));
    void api<PlanetAtlasDto>("/api/planet-atlas", { signal: controller.signal, cache: "no-cache" })
      .then((next) => { setAtlas(next); writeCachedPlanet(userId, next); setError(""); })
      .catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Не удалось открыть планету"); });
    return () => controller.abort();
  }, [refreshToken, userId]);
  const planet = useMemo(() => atlas ? projectPlanetAtlas(atlas) : null, [atlas]);
  const selectCountry = async (countryId: string) => {
    if (selectingCountryId) return;
    setSelectingCountryId(countryId);
    try {
      await onCountrySelect(countryId);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось открыть страну");
    } finally { setSelectingCountryId(null); }
  };

  if (!planet && error) return <div className="atlas-state" role="alert"><strong>Планета недоступна</strong><span>{error}</span></div>;
  if (!planet) return <div className="atlas-state" role="status"><i /><span>Собираем материки…</span></div>;
  return <div className="planet-atlas" data-planet-countries={planet.countries.length} data-planet-routes={planet.routes.length}>
    <svg viewBox={planet.viewBox} role="group" aria-label={`Планета: ${planet.countries.length} стран`} preserveAspectRatio="xMidYMid slice">
      <defs>
        <pattern id="planet-water-pixels" width="16" height="16" patternUnits="userSpaceOnUse">
          <rect width="16" height="16" fill="#1f6782" />
          <rect x="2" y="3" width="4" height="1" fill="#4f9bae" opacity=".65" />
          <rect x="10" y="11" width="3" height="1" fill="#15556f" />
        </pattern>
      </defs>
      <rect width={planet.width} height={planet.height} fill="#174f69" />
      <g className="planet-ocean" aria-hidden="true">
        {planet.oceanCells.map((cell) => <path key={`${cell.q}:${cell.r}`} d={planetHexPath(cell, planet.hexRadius)} fill="url(#planet-water-pixels)" />)}
      </g>
      <g className="planet-water-sparkles" aria-hidden="true">
        {planet.oceanCells.filter((cell) => Math.abs(cell.q * 31 + cell.r * 17) % 53 === 0).map((cell, index) => {
          const center = planetHexCenter(cell, planet.hexRadius);
          return <rect key={`${cell.q}:${cell.r}`} x={center.x - 3} y={center.y - 1} width={index % 3 === 0 ? 6 : 4} height="1" data-phase={index % 2} />;
        })}
      </g>
      <g className="planet-coast" aria-hidden="true">
        {planet.coastCells.map((cell) => <path key={`${cell.q}:${cell.r}`} d={planetHexPath(cell, planet.hexRadius)} />)}
      </g>
      <g className="planet-routes" aria-hidden="true">
        {planet.routes.map((route) => <g key={route.id}>
          <path d={route.path} className="planet-route-line" />
          <AtlasAircraft path={route.path} durationSeconds={route.durationSeconds} delaySeconds={route.delaySeconds} kind={route.planeKind} facing={route.facing} />
        </g>)}
      </g>
      <g className="planet-countries">
        {planet.countries.map((country) => <g
          key={country.id}
          className="planet-country"
          data-country-id={country.id}
          data-active={country.id === activeCountryId ? "true" : "false"}
          data-selecting={country.id === selectingCountryId ? "true" : "false"}
          role="button"
          tabIndex={0}
          aria-label={`Открыть страну ${country.name}, ${country.cityCount} городов, прогресс ${country.progress}%`}
          onClick={() => { void selectCountry(country.id); }}
          onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); void selectCountry(country.id); } }}
        >
          <circle className="planet-country-hit" cx={country.center.x} cy={country.center.y} r="22" />
          {country.cells.map((cell) => <path key={`${cell.q}:${cell.r}`} d={planetHexPath(cell, planet.hexRadius)} fill={country.color} stroke={country.accent} />)}
          <CountryLabel country={country} />
        </g>)}
      </g>
      <g className="planet-clouds" aria-hidden="true">
        {planet.clouds.map((cloud) => <g key={cloud.id} transform={`translate(${cloud.x} ${cloud.y}) scale(${cloud.scale})`} style={{ "--cloud-duration": `${cloud.durationSeconds}s`, "--cloud-delay": `${cloud.delaySeconds}s` } as React.CSSProperties}>
          <path d="M0 8h7V4h6V1h9v3h7v4h9v6H0Z" />
          <path className="planet-cloud-shade" d="M7 14h24v3H7Z" />
        </g>)}
      </g>
    </svg>
    <div className="planet-edge-fog" aria-hidden="true">
      {planet.edgeFog.map((fog) => <i key={fog.id} style={{ left: `${fog.xPercent}%`, top: `${fog.yPercent}%`, scale: fog.scale }} />)}
    </div>
    {error && <div className="planet-refresh-warning" role="status">Показана сохранённая планета</div>}
  </div>;
}
