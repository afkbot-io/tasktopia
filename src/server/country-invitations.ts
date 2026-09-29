import { randomBytes, randomUUID } from "node:crypto";
import type { Db } from "./db";
import { transaction } from "./db";
import { hashToken } from "./auth";

export async function createCountryInvitation(db: Db, countryId: string, createdBy: string, email: string, role: "MEMBER" | "VIEWER") {
  const token = randomBytes(32).toString("base64url");
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 86400_000).toISOString();
  await transaction(db, async () => {
    // Country lock serializes rotations for this email without keeping an old valid link.
    await db.prepare("SELECT id FROM countries WHERE id = ? FOR UPDATE").get(countryId);
    await db.prepare("UPDATE country_invitations SET revoked_at = now() WHERE country_id = ? AND email = ? AND consumed_at IS NULL AND revoked_at IS NULL").run(countryId, email.toLowerCase());
    await db.prepare("INSERT INTO country_invitations(id,country_id,email,role,token_hash,created_by,expires_at) VALUES(?,?,?,?,?,?,?)").run(id,countryId,email.toLowerCase(),role,hashToken(token),createdBy,expiresAt);
  });
  return { id, token, email: email.toLowerCase(), role, expiresAt };
}

export async function acceptCountryInvitation(db: Db, token: string, userId: string, email: string): Promise<string | null> {
  return transaction(db, async () => {
    const candidate = await db.prepare("SELECT country_id FROM country_invitations WHERE token_hash = ?").get(hashToken(token));
    if (!candidate) return null;
    // Use the same lock order as rotation/removal, then recheck validity.
    await db.prepare("SELECT id FROM countries WHERE id = ? FOR UPDATE").get(candidate.country_id);
    const invitation = await db.prepare("SELECT * FROM country_invitations WHERE token_hash = ? AND email = ? AND revoked_at IS NULL AND consumed_at IS NULL AND expires_at > now() FOR UPDATE").get(hashToken(token), email.toLowerCase());
    if (!invitation) return null;
    // An invitation cannot promote or demote an existing member, especially OWNER.
    await db.prepare("INSERT INTO country_members(country_id,user_id,role,invited_by_user_id,created_at) VALUES(?,?,?,?,now()) ON CONFLICT(country_id,user_id) DO NOTHING").run(invitation.country_id,userId,invitation.role,invitation.created_by);
    await db.prepare("UPDATE country_invitations SET consumed_at = now() WHERE id = ?").run(invitation.id);
    await db.prepare("UPDATE users SET active_country_id = ? WHERE id = ?").run(invitation.country_id,userId);
    return String(invitation.country_id);
  });
}
