import { useEffect, useRef, useState } from 'react';
import type { CityAlbumPageDto } from '../../shared/city-album';
import { ApiError, api } from '../api';
import { cityAlbumComparison, CITY_ALBUM_LABELS } from '../city-album-presentation';
import { useDialogFocus } from '../use-dialog-focus';
import './city-album.css';

export function CityAlbum({ countryId, cityId, cityName, revision, onClose, onTask, onAuthenticationRequired }: {
  countryId: string; cityId: string; cityName: string; revision: number; onClose: () => void;
  onTask: (id: string) => void; onAuthenticationRequired?: () => void;
}) {
  const dialog = useRef<HTMLElement>(null);
  useDialogFocus(dialog, { onClose });
  const [cursors, setCursors] = useState<(string | null)[]>([null]), cursor = cursors.at(-1)!;
  const [data, setData] = useState<CityAlbumPageDto>();
  const [busy, setBusy] = useState(true), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); let alive = true;
    setBusy(true); setError('');
    const timeout = window.setTimeout(() => controller.abort(new DOMException('Не удалось загрузить альбом вовремя. Повторите попытку.', 'TimeoutError')), 15_000);
    const query = new URLSearchParams({ limit: '20' }); if (cursor) query.set('cursor', cursor);
    void api<CityAlbumPageDto>(`/api/countries/${encodeURIComponent(countryId)}/cities/${encodeURIComponent(cityId)}/album?${query}`, { signal: controller.signal }).then(page => {
      if (page.kind !== 'city.album-page' || page.version !== 1 || page.countryId !== countryId || page.cityId !== cityId || !Array.isArray(page.items) || page.items.length > 20)
        throw new Error('Не удалось прочитать альбом города.');
      if (alive) setData(page);
    }).catch(reason => {
      if (!alive) return;
      if (reason instanceof ApiError && [401, 403, 404].includes(reason.status)) setData(undefined);
      if (reason instanceof ApiError && [401, 403].includes(reason.status)) void Promise.resolve(onAuthenticationRequired?.()).catch(() => undefined);
      setError(reason instanceof Error ? reason.message : 'Не удалось загрузить альбом.');
    }).finally(() => { window.clearTimeout(timeout); if (alive) setBusy(false); });
    return () => { alive = false; window.clearTimeout(timeout); controller.abort(); };
  }, [countryId, cityId, cursor, revision, retry, onAuthenticationRequired]);
  const page = (direction: 'next' | 'previous') => {
    if (busy) return;
    setData(undefined); setBusy(true);
    if (direction === 'next' && data?.nextCursor) setCursors(current => [...current, data.nextCursor]);
    else if (direction === 'previous' && cursors.length > 1) setCursors(current => current.slice(0, -1));
  };
  return <div className="modal-backdrop" onMouseDown={event => { if (event.currentTarget === event.target) onClose(); }}>
    <section ref={dialog} className="city-album" role="dialog" aria-modal="true" aria-labelledby="city-album-title" aria-busy={busy}>
      <header><div><h2 id="city-album-title">Альбом города</h2><p>{cityName}</p></div><button type="button" className="modal-close" aria-label="Закрыть альбом" onClick={onClose}>×</button></header>
      {error && <p className="city-album-error" role="alert">{error} <button type="button" onClick={() => setRetry(value => value + 1)}>Повторить</button></p>}
      {busy && <p role="status">Открываем историю города…</p>}
      {data && <ol className="city-album-milestones">{data.items.map(item => {
        const comparison = item.before && item.after ? cityAlbumComparison(item.before, item.after) : [];
        return <li key={item.eventId}>
          <time dateTime={item.at}>{new Date(item.at).toLocaleString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</time>
          <h3>{CITY_ALBUM_LABELS[item.type]}</h3>
          {item.task && (item.task.exists ? <button type="button" className="city-album-task" onClick={() => onTask(item.task!.id)}>#{item.task.taskNumber} · {item.task.title}</button> : <p>#{item.task.taskNumber} · {item.task.title} <small>Объект удалён</small></p>)}
          {comparison.length > 0 && <table><caption>Как изменился город</caption><thead><tr><th scope="col">Развитие</th><th scope="col">До</th><th scope="col">После</th></tr></thead><tbody>{comparison.map(row => <tr key={row.label}><th scope="row">{row.label}</th><td>{row.before}</td><td>{row.after}</td></tr>)}</tbody></table>}
        </li>;
      })}</ol>}
      {data && !data.items.length && <p>В альбоме пока нет вех развития.</p>}
      <footer><nav aria-label="Страницы альбома"><button type="button" disabled={busy || cursors.length <= 1} onClick={() => page('previous')}>Назад</button><span>Страница {cursors.length}</span><button type="button" disabled={busy || !data?.nextCursor} onClick={() => page('next')}>Далее</button></nav></footer>
    </section>
  </div>;
}
