import { randomBytes } from "node:crypto";
import type { Db } from "./db";
import { transaction, now } from "./db";
import { hashPassword, hashToken, verifyPassword } from "./auth";

export async function issueRecoveryCodes(db: Db, userId: string, password: string): Promise<string[] | null> {
  return transaction(db, async () => {
    const user = await db.prepare("SELECT password_hash FROM users WHERE id = ? FOR UPDATE").get(userId);
    if (!user || !await verifyPassword(password, String(user.password_hash))) return null;
    const codes = Array.from({ length: 8 }, () => randomBytes(16).toString("hex"));
    await db.prepare("DELETE FROM account_recovery_codes WHERE user_id = ?").run(userId);
    for (const code of codes) await db.prepare("INSERT INTO account_recovery_codes(user_id,code_hash) VALUES(?,?)").run(userId,hashToken(code));
    return codes;
  });
}
export async function recoverAccount(db: Db, email: string, code: string, password: string): Promise<string | null> {
  const passwordHash = await hashPassword(password);
  return transaction(db, async () => {
    const user = await db.prepare("SELECT id FROM users WHERE email = ? FOR UPDATE").get(email.trim().toLowerCase());
    if (!user) return null;
    const consumed = await db.prepare("DELETE FROM account_recovery_codes WHERE user_id = ? AND code_hash = ? RETURNING user_id").run(user.id,hashToken(code.trim().toLowerCase()));
    if (!consumed.changes) return null;
    await db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash,user.id);
    await db.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id);
    await db.prepare("UPDATE mcp_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").run(now(),user.id);
    await db.prepare("DELETE FROM account_recovery_codes WHERE user_id = ?").run(user.id);
    return String(user.id);
  });
}
