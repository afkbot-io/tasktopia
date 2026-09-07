import { useEffect, useRef, useState } from "react";
import type { PlanDistrictDto, TaskDto } from "../../shared/contracts";
import { api } from "../api";
import { forgetTaskDetail } from "../task-detail-cache";
import { Button } from "./ui";

export function TaskTransferPanel({ countryId, task, onTransferred }: {
  countryId: string; task: TaskDto; onTransferred: (task: TaskDto) => void;
}) {
  const [open, setOpen] = useState(false);
  const [districts, setDistricts] = useState<PlanDistrictDto[]>([]);
  const [target, setTarget] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [retry, setRetry] = useState(0);
  const pending = useRef(false);
  const mounted = useRef(true);
  const intent = useRef<{ target: string; key: string } | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true); setError("");
    void api<PlanDistrictDto[]>(`/api/plan/cities/${task.cityId}/districts`, { signal: controller.signal })
      .then(items => { if (!controller.signal.aborted) setDistricts(items); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Не удалось загрузить спринты"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open, task.cityId, retry]);
  const available = districts.filter(district => district.id !== task.districtId && (district.status === "ACTIVE" || district.status === "PLANNED"));
  const transfer = async () => {
    if (pending.current || !available.some(district => district.id === target)) return;
    pending.current = true; setBusy(true); setError("");
    if (intent.current?.target !== target) intent.current = { target, key: crypto.randomUUID() };
    try {
      const moved = await api<TaskDto>(`/api/tasks/${task.id}/transfer`, { method: "POST", json: { targetDistrictId: target, idempotencyKey: intent.current.key } });
      forgetTaskDetail(countryId, task.id);
      if (!mounted.current) return;
      onTransferred(moved);
      setNotice("Задача перенесена. На прежнем участке сохранена метка MOVE.");
      setOpen(false); setTarget(""); intent.current = null;
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : "Не удалось перенести задачу");
      // Keep this attempt's key after uncertain network failures; retry must
      // never create another historical site or perform a second transfer.
    } finally {
      pending.current = false; if (mounted.current) setBusy(false);
    }
  };
  return <section className="task-transfer-panel">
    {notice && <p role="status">{notice}</p>}
    {!open ? <Button onClick={() => { setNotice(""); setOpen(true); }}>Перенести в другой спринт</Button> : <>
      <h3>Перенос задачи</h3>
      <p>Номер, прогресс и история сохранятся. В другом спринте появится новая площадка, а прежний участок навсегда останется занятым меткой MOVE.</p>
      <label className="task-transfer-target">Спринт в этом городе<select value={target} disabled={loading || busy} onChange={event => setTarget(event.target.value)}>
        <option value="">Выберите спринт</option>
        {available.map(district => <option key={district.id} value={district.id}>{district.name}</option>)}
      </select></label>
      {loading && <p role="status">Загружаем спринты…</p>}
      {!loading && !error && available.length === 0 && <p>В этом городе нет другого открытого спринта.</p>}
      {error && <p role="alert">{error}</p>}
      <div className="task-transfer-actions">
        <Button disabled={!target || loading || busy} onClick={() => void transfer()}>{busy ? "Переносим…" : "Подтвердить перенос"}</Button>
        {error && !busy && <Button onClick={() => setRetry(value => value + 1)}>Обновить спринты</Button>}
        <Button disabled={busy} variant="quiet" onClick={() => setOpen(false)}>Отмена</Button>
      </div>
    </>}
  </section>;
}
