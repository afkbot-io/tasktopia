import { useRef, useState } from 'react';
import { CITY_NEWS_KINDS, type CityNewsItem, type CityNewsKind } from '../../shared/city-news';
import { newsItemKey } from '../news-feed-state';
import { useNewsFeed } from '../use-news-feed';
import { useToolbarDisclosure } from '../use-toolbar-disclosure';
import '../news-feed.css';

const labels: Record<CityNewsKind, string> = {
  COMPLETED: 'Строительство завершено', DEFECT: 'Нужен ремонт',
  OPENED: 'Открыта городская служба', ASSIGNED: 'Вы назначены исполнителем',
  COMMENT: 'Новый комментарий', MATERIAL: 'Обновлены материалы', TESTING: 'Готово к приёмке',
};
export function WorldDigest({ userId, countryId, revision = 0, onAuthenticationRequired, onTask }: {
  userId: string; countryId: string; revision?: number;
  onAuthenticationRequired?: () => Promise<void>; onTask: (id: string) => void;
}) {
  const root = useToolbarDisclosure();
  const heading = useRef<HTMLHeadingElement>(null);
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState(false);
  const [kind, setKind] = useState<CityNewsKind>();
  const feed = useNewsFeed({ userId, countryId, revision, open, history, kind, onAuthenticationRequired });
  const unread = feed.data?.items.filter(item => item.unread) ?? [];
  const acknowledge = async (items: CityNewsItem[]) => {
    const origin = document.activeElement;
    if (await feed.acknowledge(items) && root.current?.open && (document.activeElement === origin || !origin?.isConnected)) heading.current?.focus();
  };
  return <details ref={root} className="world-digest game-popover" open={open} onToggle={event => {
    const next = event.currentTarget.open; setOpen(next);
    if (next) feed.latest();
  }}>
    <summary aria-label="Уведомления" title="Уведомления">
      <svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M7 3V2h4v1M4 12V7a5 5 0 0 1 10 0v5l1 2H3l1-2ZM7 16h4" />
      </svg>
      {feed.unreadCount > 0 && <span className="notification-count" aria-label={`${feed.unreadCount} непрочитанных`}>{feed.unreadCount > 99 ? '99+' : feed.unreadCount}</span>}
    </summary>
    {open && <section className="game-popover-panel news-feed" aria-label="Уведомления">
      <div className="world-digest-heading"><h2 tabIndex={-1} ref={heading}>Новости мира</h2><button type="button" aria-label="Закрыть сводку" onClick={() => setOpen(false)}>×</button></div>
      <nav className="document-tabs" aria-label="Лента уведомлений">
        <button type="button" aria-pressed={!history} disabled={feed.busy} onClick={() => setHistory(false)}>Новые</button>
        <button type="button" aria-pressed={history} disabled={feed.busy} onClick={() => setHistory(true)}>История</button>
      </nav>
      <label className="news-kind">События<select aria-label="Тип уведомлений" value={kind ?? ''} disabled={feed.busy} onChange={event => setKind(event.target.value ? event.target.value as CityNewsKind : undefined)}>
        <option value="">Все события</option>{CITY_NEWS_KINDS.map(value => <option key={value} value={value}>{labels[value]}</option>)}
      </select></label>
      <small>За последние 30 дней</small>
      {feed.error ? <p role="alert">{feed.error} <button type="button" onClick={feed.retry}>Повторить</button></p>
        : !feed.data ? <p role="status">Получаем новости…</p> : <>
          <div className="news-read-page"><button type="button" disabled={!unread.length || feed.busy || feed.pending} onClick={() => { void acknowledge(unread); }}>Отметить страницу прочитанной</button></div>
          <ul aria-label="События мира" aria-busy={feed.pending}>
            {feed.data.items.map(item => <li key={newsItemKey(item)} data-news-key={newsItemKey(item)} data-event={item.lastEventId} data-unread={item.unread}>
              <button className="news-task" type="button" onClick={() => { setOpen(false); onTask(item.taskId); }}>
                <strong>№{item.taskNumber} · {item.title}</strong>
                <span>{labels[item.kind]}{item.count > 1 ? ` · ${item.count}` : ''} · {item.cityName}</span>
                <time dateTime={item.at}>{new Date(item.at).toLocaleString('ru-RU')}</time>
              </button>
              {item.unread && <button type="button" className="news-mark-read" disabled={feed.busy} aria-label={`Отметить прочитанным: №${item.taskNumber}, ${labels[item.kind]}`} onClick={() => { void acknowledge([item]); }}>Отметить прочитанным</button>}
            </li>)}
          </ul>
          {!feed.data.items.length && <p>{history ? 'В истории пока нет событий.' : 'Новых событий пока нет.'}</p>}
        </>}
      <div className="news-action-status" aria-live="polite">{feed.busy ? 'Сохраняем прочтение…' : feed.saved ? 'Прочтение сохранено.' : ''}</div>
      {feed.readError && <p role="alert">Не удалось сохранить прочтение. <button type="button" onClick={feed.retryRead}>Повторить сохранение</button></p>}
      <nav className="news-pagination" aria-label="Страницы уведомлений">
        <button type="button" disabled={!feed.hasPrevious || feed.busy || feed.pending} onClick={feed.previous}>Назад</button>
        <span role="status">Страница {feed.pageNumber}</span>
        <button type="button" disabled={!feed.hasNext || feed.busy || feed.pending} onClick={feed.next}>Далее</button>
      </nav>
      {feed.hasPrevious && <button type="button" disabled={feed.busy} onClick={feed.latest}>К последним</button>}
    </section>}
  </details>;
}
