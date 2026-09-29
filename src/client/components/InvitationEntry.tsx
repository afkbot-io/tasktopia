import { useState } from "react";
import { api } from "../api";
import { Button } from "./ui";
export function InvitationEntry({ token, email, onDone }: { token: string; email: string; onDone: () => Promise<void> }) {
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  return <main className="auth-screen"><section className="account-entry settings-panel settings-body"><h1>Приглашение в страну</h1><p>Вы вошли как {email}. Примите приглашение, чтобы открыть страну.</p>{error && <p role="alert">{error}</p>}
    <Button disabled={busy} onClick={() => { setBusy(true); setError(""); void api("/api/invitations/accept", { method: "POST", json: { token } }).then(onDone).catch(reason => { setError(reason.message); setBusy(false); }); }}>Принять приглашение</Button>
    <Button disabled={busy} onClick={() => void onDone()}>Вернуться в свой мир</Button>
  </section></main>;
}
