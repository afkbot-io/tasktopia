import { useState } from "react";
import { api } from "../api";
import { Button } from "./ui";
import { AuthPanel } from './AuthPanel';
export function InvitationEntry({ token, email, onDone }: { token: string; email: string; onDone: () => Promise<void> }) {
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  return <main className="auth-screen auth-screen-single"><section className="auth-entry"><AuthPanel title="Приглашение в страну"><p>Вы вошли как {email}. Примите приглашение, чтобы открыть страну.</p>{error && <div className="form-error" role="alert">{error}</div>}
    <Button variant="primary" disabled={busy} onClick={() => { setBusy(true); setError(""); void api("/api/invitations/accept", { method: "POST", json: { token } }).then(onDone).catch(reason => { setError(reason.message); setBusy(false); }); }}>{busy ? 'Подождите…' : 'Принять приглашение'}</Button>
    <Button variant="quiet" disabled={busy} onClick={() => void onDone()}>Вернуться в свой мир</Button>
  </AuthPanel></section></main>;
}
