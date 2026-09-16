import { useEffect, useState } from "react";
import type { PlanDistrictDto } from "../../shared/contracts";
import { PROP_SPRITES } from "../../shared/catalog";
import { api } from "../api";

/** Plans without plots belong to the city noticeboard, not invented land. */
export function DistrictPlans({ cityId, countryId, revision, onSelect }: {
  cityId: string; countryId: string; revision: number; onSelect: (districtId: string) => void;
}) {
  const [snapshot, setSnapshot] = useState<{ scope: string; districts: PlanDistrictDto[] }>();
  const scope = `${countryId}:${cityId}`;
  useEffect(() => {
    const controller = new AbortController();
    void api<PlanDistrictDto[]>(`/api/plan/cities/${cityId}/districts`, { signal: controller.signal })
      .then(districts => { if (!controller.signal.aborted) setSnapshot({ scope, districts }); })
      .catch(() => { if (!controller.signal.aborted) setSnapshot(undefined); });
    return () => controller.abort();
  }, [cityId, scope, revision]);
  const empty = snapshot?.scope === scope ? snapshot.districts.filter(d => d.taskCount === 0 && (d.status === "PLANNED" || d.status === "ACTIVE")) : [];
  if (!empty.length) return null;
  return <nav className="district-plans" aria-label="Районы без участков">
    {empty.slice(0, 3).map(district => <button key={district.id} type="button" onClick={() => onSelect(district.id)}>
      <img src={PROP_SPRITES[district.status === "ACTIVE" ? "district-development-active" : "district-development-planned"]} alt="" />
      <span>{district.name}<small>{district.status === "ACTIVE" ? "Подготовка района" : "Запланирован"}</small></span>
    </button>)}
    {empty.length > 3 && <button type="button" onClick={() => onSelect(empty[3]!.id)}>Ещё {empty.length - 3}</button>}
  </nav>;
}
