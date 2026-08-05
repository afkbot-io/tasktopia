import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { MCP_READ_SCOPES, MCP_SCOPES, type BootstrapDto, type McpScope, type McpTokenDto } from "../../shared/contracts";
import { api, ApiError } from "../api";

const scopeLabels: Record<McpScope, string> = {
  "country:read": "Читать страну", "cities:write": "Создавать города", "districts:write": "Управлять районами",
  "tasks:read": "Читать задачи", "tasks:write": "Изменять задачи", "comments:write": "Добавлять комментарии",
};

type SettingsSection = "mcp" | "account";
type CopyTarget = "endpoint" | "guide" | "secret" | "example";

export function TokenPanel({ bootstrap, initialSection, onClose, onAccountChanged, onLogout }: {
  bootstrap: BootstrapDto;
  initialSection: SettingsSection;
  onClose: () => void;
  onAccountChanged: () => Promise<void>;
  onLogout: () => Promise<void>;
}) {
  const [section, setSection] = useState<SettingsSection>(initialSection);
  const [tokens, setTokens] = useState<McpTokenDto[]>([]);
  const [secret, setSecret] = useState<string | null>(null);
  const [tokenName, setTokenName] = useState("Tasktopia MCP");
  const allowedScopes = bootstrap.countryRole === "VIEWER" ? MCP_READ_SCOPES : MCP_SCOPES;
  const [scopes, setScopes] = useState<McpScope[]>([...allowedScopes]);
  const [expiresInDays, setExpiresInDays] = useState<30 | 90 | 365>(90);
  const [accountName, setAccountName] = useState(bootstrap.user.name);
  const [pending, setPending] = useState(false);
  const [copyTarget, setCopyTarget] = useState<CopyTarget | null>(null);
  const [error, setError] = useState("");
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);

  const endpoint = `${location.origin}/mcp`;
  const aiGuide = `${location.origin}/ai.md`;
  const connectionExample = `URL: ${endpoint}\nAuthorization: Bearer ВАШ_КЛЮЧ\nTransport: Streamable HTTP`;
  const load = useCallback(() => api<McpTokenDto[]>("/api/tokens").then(setTokens), []);

  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    void load().catch(() => setError("Не удалось загрузить ключи доступа"));
    closeRef.current?.focus({ preventScroll: true });

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = [...panelRef.current.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [href], [tabindex]:not([tabindex='-1'])")];
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previouslyFocused?.focus({ preventScroll: true });
    };
  }, [load]);

  async function copy(value: string, target: CopyTarget) {
    try {
      await navigator.clipboard.writeText(value);
      setCopyTarget(target);
      window.setTimeout(() => setCopyTarget((current) => current === target ? null : current), 1800);
    } catch {
      setError("Не удалось скопировать. Выделите значение вручную");
    }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const token = await api<{ token: string }>("/api/tokens", {
        method: "POST", json: { name: tokenName.trim(), scopes, expiresInDays },
      });
      setSecret(token.token);
      setCopyTarget(null);
      await load();
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "Не удалось создать ключ");
    } finally {
      setPending(false);
    }
  }

  async function revoke(id: string) {
    setPending(true);
    setError("");
    try {
      await api(`/api/tokens/${id}`, { method: "DELETE" });
      await load();
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "Не удалось отозвать ключ");
    } finally {
      setPending(false);
    }
  }

  async function saveAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      await api("/api/account", { method: "PATCH", json: { name: accountName.trim() } });
      await onAccountChanged();
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "Не удалось сохранить имя");
    } finally {
      setPending(false);
    }
  }

  const activeTokens = tokens.filter((token) => !token.revokedAt);

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <section ref={panelRef} className="token-panel settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <header className="settings-header">
        <div><p className="eyebrow">НАСТРОЙКИ</p><h2 id="settings-title">Аккаунт и интеграции</h2></div>
        <button ref={closeRef} type="button" className="modal-close" onClick={onClose} aria-label="Закрыть">×</button>
        <nav className="settings-tabs" aria-label="Разделы настроек">
          <button type="button" className={section === "mcp" ? "active" : ""} aria-current={section === "mcp" ? "page" : undefined} onClick={() => setSection("mcp")}>MCP-интеграция</button>
          <button type="button" className={section === "account" ? "active" : ""} aria-current={section === "account" ? "page" : undefined} onClick={() => setSection("account")}>Профиль</button>
        </nav>
      </header>

      <div className="settings-body">
        {error && <div className="form-error settings-error" role="alert">{error}</div>}

        {section === "mcp" ? <>
          <section className="settings-section mcp-connect-section" aria-labelledby="mcp-connect-title">
            <div className="settings-section-heading"><span className="step-badge">1</span><div><h3 id="mcp-connect-title">Подключите MCP-клиент</h3><p>Используйте один endpoint и передавайте ключ в заголовке Authorization.</p></div></div>
            <div className="endpoint-card">
              <div><span>URL подключения</span><code>{endpoint}</code></div>
              <button type="button" onClick={() => void copy(endpoint, "endpoint")}>{copyTarget === "endpoint" ? "Скопировано" : "Копировать URL"}</button>
            </div>
            <div className="mcp-guide-card">
              <div><strong>Документация для ИИ</strong><span>Готовая настройка, инструменты, права и безопасный сценарий работы.</span><code>{aiGuide}</code></div>
              <div className="mcp-guide-actions">
                <a href={aiGuide} target="_blank" rel="noreferrer">Открыть ai.md</a>
                <button type="button" onClick={() => void copy(aiGuide, "guide")}>{copyTarget === "guide" ? "Ссылка скопирована" : "Копировать ссылку"}</button>
              </div>
            </div>
            <ol className="mcp-steps">
              <li>Выберите в MCP-клиенте подключение типа <strong>Streamable HTTP</strong>.</li>
              <li>Вставьте URL выше и добавьте заголовок <code>Authorization: Bearer ВАШ_КЛЮЧ</code>.</li>
              <li>Сохраните подключение. После этого клиент увидит инструменты Tasktopia.</li>
            </ol>
            <details className="mcp-example">
              <summary>Показать параметры подключения</summary>
              <pre>{connectionExample}</pre>
              <button type="button" onClick={() => void copy(connectionExample, "example")}>{copyTarget === "example" ? "Скопировано" : "Копировать параметры"}</button>
            </details>
          </section>

          <section className="settings-section" aria-labelledby="mcp-key-title">
            <div className="settings-section-heading"><span className="step-badge">2</span><div><h3 id="mcp-key-title">Создайте ключ доступа</h3><p>Секрет показывается один раз. Храните его в менеджере секретов вашего MCP-клиента.</p></div></div>

            {secret && <div className="token-secret" role="status">
              <div><strong>Ключ готов</strong><span>Скопируйте его сейчас — повторно секрет не показывается.</span></div>
              <code>{secret}</code>
              <button type="button" className="primary-button" onClick={() => void copy(secret, "secret")}>{copyTarget === "secret" ? "Ключ скопирован" : "Скопировать ключ"}</button>
            </div>}

            <form className="token-form" onSubmit={create}>
              <label className="token-name-field">Название ключа<input value={tokenName} onChange={(event) => setTokenName(event.target.value)} minLength={2} maxLength={80} required /></label>
              <label>Срок действия<select value={expiresInDays} onChange={(event) => setExpiresInDays(Number(event.target.value) as 30 | 90 | 365)}><option value={30}>30 дней</option><option value={90}>90 дней</option><option value={365}>1 год</option></select></label>
              <fieldset><legend>Разрешения</legend>{allowedScopes.map((scope) => <label key={scope}><input type="checkbox" checked={scopes.includes(scope)} onChange={(event) => setScopes((current) => event.target.checked ? [...current, scope] : current.filter((item) => item !== scope))} />{scopeLabels[scope]}</label>)}</fieldset>
              {activeTokens.length > 0 && <p className="token-warning">Создание нового персонального ключа автоматически отзовёт текущий.</p>}
              <button className="primary-button token-submit" disabled={pending || scopes.length === 0 || tokenName.trim().length < 2}>{pending ? "Подождите…" : activeTokens.length > 0 ? "Заменить ключ" : "Создать ключ"}</button>
            </form>

            {tokens.length > 0 && <div className="token-list" aria-label="Созданные ключи">{tokens.map((token) => <article key={token.id} className={token.revokedAt ? "revoked" : ""}><div><strong>{token.name}</strong><code>{token.prefix}…</code><small>{token.scopes.map((scope) => scopeLabels[scope]).join(" · ")}<br />{token.expiresAt ? `Действует до ${new Date(token.expiresAt).toLocaleDateString("ru-RU")}` : "Без срока"}</small></div><span className="token-status">{token.revokedAt ? "Отозван" : token.lastUsedAt ? "Использовался" : "Активен"}</span>{!token.revokedAt && <button type="button" disabled={pending} onClick={() => void revoke(token.id)}>Отозвать</button>}</article>)}</div>}
          </section>
        </> : <>
          <section className="settings-section profile-section" aria-labelledby="profile-title">
            <div className="settings-section-heading"><div><h3 id="profile-title">Личные данные</h3><p>{bootstrap.user.email}</p></div></div>
            <form className="profile-form" onSubmit={saveAccount}>
              <label>Имя и фамилия<input value={accountName} onChange={(event) => setAccountName(event.target.value)} minLength={2} maxLength={60} required autoComplete="name" /></label>
              <button className="primary-button" disabled={pending || accountName.trim().length < 2 || accountName.trim() === bootstrap.user.name}>{pending ? "Сохраняем…" : "Сохранить изменения"}</button>
            </form>
          </section>
          <section className="settings-section danger-section" aria-labelledby="session-title">
            <div className="settings-section-heading"><div><h3 id="session-title">Текущая сессия</h3><p>Завершите сессию на этом устройстве.</p></div></div>
            <button type="button" className="logout-button" onClick={() => void onLogout()}>Выйти из аккаунта</button>
          </section>
        </>}
      </div>
    </section>
  </div>;
}
