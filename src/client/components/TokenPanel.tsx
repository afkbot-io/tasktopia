import { useEffect, useRef, useState } from "react";
import type { BootstrapDto } from "../../shared/contracts";
import { api, ApiError } from "../api";

type TokenMeta = { id: string; name: string; prefix: string; createdAt: string; revokedAt: string | null; lastUsedAt: string | null };

export function TokenPanel({ bootstrap, onClose, onAccountChanged, onLogout }: {
  bootstrap: BootstrapDto;
  onClose: () => void;
  onAccountChanged: () => Promise<void>;
  onLogout: () => Promise<void>;
}) {
  const [tokens, setTokens] = useState<TokenMeta[]>([]);
  const [secret, setSecret] = useState<string | null>(null);
  const [tokenName, setTokenName] = useState("Персональный MCP");
  const [accountName, setAccountName] = useState(bootstrap.user.name);
  const [error, setError] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);
  const load = () => api<TokenMeta[]>("/api/tokens").then(setTokens);
  useEffect(() => {
    void load();
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function create() {
    setError("");
    try {
      const token = await api<{ token: string }>("/api/tokens", { method: "POST", body: JSON.stringify({ name: tokenName }) });
      setSecret(token.token);
      await load();
    } catch (reason) { setError(reason instanceof ApiError ? reason.message : "Не удалось перевыпустить ссылку"); }
  }

  async function revoke(id: string) {
    await api(`/api/tokens/${id}`, { method: "DELETE" });
    await load();
  }

  async function saveAccount() {
    setError("");
    try {
      await api("/api/account", { method: "PATCH", body: JSON.stringify({ name: accountName }) });
      await onAccountChanged();
    } catch (reason) { setError(reason instanceof ApiError ? reason.message : "Не удалось сохранить имя"); }
  }

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <section className="token-panel settings-panel" role="dialog" aria-modal="true" aria-labelledby="token-title">
      <button ref={closeRef} className="modal-close" onClick={onClose} aria-label="Закрыть">×</button>
      <p className="eyebrow">НАСТРОЙКИ</p><h2 id="token-title">Аккаунт и MCP</h2>
      {error && <div className="form-error settings-error">{error}</div>}
      <section className="settings-section"><h3>Личные данные</h3><p className="muted">{bootstrap.user.email}</p>
        <div className="token-create"><input aria-label="Имя и фамилия" value={accountName} onChange={(event) => setAccountName(event.target.value)} maxLength={60} /><button onClick={() => void saveAccount()} disabled={accountName.trim().length < 2 || accountName.trim() === bootstrap.user.name}>Сохранить</button></div>
      </section>
      <section className="settings-section"><h3>Персональная MCP-ссылка</h3>
        <p className="muted">Endpoint: <code>{location.origin}/mcp</code>. Ключ принадлежит вашему аккаунту и работает с выбранной страной.</p>
        <div className="token-create"><input value={tokenName} onChange={(event) => setTokenName(event.target.value)} maxLength={80} /><button className="primary-button" onClick={() => void create()}>Перевыпустить</button></div>
        <p className="token-warning">Новый ключ автоматически отключит предыдущий персональный ключ.</p>
        {secret && <div className="token-secret"><strong>Скопируйте сейчас — повторно секрет не показывается.</strong><code>{secret}</code><button onClick={() => void navigator.clipboard.writeText(secret)}>Копировать</button></div>}
        <div className="token-list">{tokens.map((token) => <article key={token.id} className={token.revokedAt ? "revoked" : ""}><div><strong>{token.name}</strong><code>{token.prefix}…</code></div><span>{token.revokedAt ? "Отозван" : token.lastUsedAt ? "Использовался" : "Новый"}</span>{!token.revokedAt && <button onClick={() => void revoke(token.id)}>Отозвать</button>}</article>)}</div>
      </section>
      <button className="logout-button" onClick={() => void onLogout()}>Выйти из аккаунта</button>
    </section>
  </div>;
}
